import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import {
  CLOCK,
  type Clock,
  EntityNotFoundError,
  Iban,
  Percentage,
  unwrap,
  VatNumber,
} from '@shared/domain';

import {
  CenterAlreadyRegisteredError,
  type TrainingCenter,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';
import { assertIsAdmin } from '../center-access';
import { type TrainingCenterDto } from '../dto/training-center.dto';
import { toTrainingCenterDto } from '../training-center.mapping';

export interface TrainingCenterChanges {
  readonly name?: string;
  readonly platformFeeBasisPoints?: number;
  readonly payoutIban?: string;
  // Both or neither: corrects the VAT number of a center that is not active.
  readonly country?: string;
  readonly taxId?: string;
  // `suspended` needs a reason; `active` reinstates a suspended center.
  readonly status?: 'suspended' | 'active';
  readonly suspensionReason?: string;
}

export class UpdateTrainingCenterCommand extends Command<TrainingCenterDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly changes: TrainingCenterChanges,
  ) {
    super();
  }
}

// Admin only: a center that could change its own payout account or fee would be one stolen login
// away from redirecting disbursements.
@CommandHandler(UpdateTrainingCenterCommand)
export class UpdateTrainingCenterHandler implements ICommandHandler<UpdateTrainingCenterCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: UpdateTrainingCenterCommand): Promise<TrainingCenterDto> {
    assertIsAdmin(command.actor, command.centerId);
    const { changes } = command;
    const iban =
      changes.payoutIban === undefined ? undefined : unwrap(Iban.create(changes.payoutIban));
    const vatNumber =
      changes.country === undefined || changes.taxId === undefined
        ? undefined
        : unwrap(VatNumber.create(changes.country, changes.taxId));

    return this.uow.run(async () => {
      const center = await this.centers.findById(command.centerId);
      if (!center) {
        throw new EntityNotFoundError('TrainingCenter', command.centerId);
      }
      const before = toTrainingCenterDto(center);
      const now = this.clock.now();
      if (changes.name !== undefined) center.rename(changes.name, now);
      if (changes.platformFeeBasisPoints !== undefined) {
        center.changePlatformFee(Percentage.fromBasisPoints(changes.platformFeeBasisPoints), now);
      }
      if (iban) center.changePayoutIban(iban, now);
      // Suspending before and reinstating after the VAT number, so "suspend and correct" and
      // "correct and reinstate" both work in one request.
      if (changes.status === 'suspended') center.suspend(changes.suspensionReason ?? '', now);
      if (vatNumber) await this.changeVatNumber(center, vatNumber, now);
      if (changes.status === 'active') center.reinstate(now);
      await this.centers.save(center);

      const after = toTrainingCenterDto(center);
      this.audit.describeChanges(
        Object.fromEntries(
          (['name', 'status', 'taxId', 'platformFeeBasisPoints', 'payoutIbanMasked'] as const)
            .filter((field) => before[field] !== after[field])
            .map((field) => [field, { before: before[field], after: after[field] }]),
        ),
      );
      return after;
    });
  }

  // One center per VAT number, checked as on registration (the unique index decides a race).
  private async changeVatNumber(
    center: TrainingCenter,
    vatNumber: VatNumber,
    now: Date,
  ): Promise<void> {
    const holder = await this.centers.findByVatNumber(vatNumber);
    if (holder && holder.id !== center.id) {
      throw new CenterAlreadyRegisteredError(vatNumber.toString());
    }
    center.changeVatNumber(vatNumber, now);
  }
}
