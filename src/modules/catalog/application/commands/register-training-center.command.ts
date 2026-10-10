import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, Iban, Percentage, unwrap, VatNumber } from '@shared/domain';

import {
  CenterAlreadyRegisteredError,
  TrainingCenter,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';
import { assertIsAdmin } from '../center-access';

export class RegisterTrainingCenterCommand extends Command<{ centerId: string }> {
  constructor(
    readonly actor: Principal,
    readonly name: string,
    readonly country: string,
    readonly taxId: string,
    readonly payoutIban: string,
    readonly platformFeeBasisPoints: number,
  ) {
    super();
  }
}

// The VAT check does not happen here: a CenterRegistered consumer asks VIES once the registration
// is committed, so a slow or failing registry never fails the registration.
@CommandHandler(RegisterTrainingCenterCommand)
export class RegisterTrainingCenterHandler implements ICommandHandler<RegisterTrainingCenterCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RegisterTrainingCenterCommand): Promise<{ centerId: string }> {
    const id = uuidv7();
    assertIsAdmin(command.actor, id);
    const vatNumber = unwrap(VatNumber.create(command.country, command.taxId));
    const payoutIban = unwrap(Iban.create(command.payoutIban));
    const platformFee = Percentage.fromBasisPoints(command.platformFeeBasisPoints);

    return this.uow.run(async () => {
      if (await this.centers.findByVatNumber(vatNumber)) {
        throw new CenterAlreadyRegisteredError(vatNumber.toString());
      }
      const center = TrainingCenter.register({
        id,
        name: command.name,
        vatNumber,
        payoutIban,
        platformFee,
        now: this.clock.now(),
      });
      await this.centers.save(center);
      return { centerId: center.id };
    });
  }
}
