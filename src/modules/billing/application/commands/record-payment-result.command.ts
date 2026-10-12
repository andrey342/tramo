import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { AUDIT_TRAIL, type AuditTrail, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CalendarDate, CLOCK, type Clock } from '@shared/domain';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  type ChargeStatus,
  UnknownCollectionAttemptError,
} from '../../domain';

// What the payment provider reports about a collection, once its callback is authenticated.
export interface PaymentResult {
  // The attempt key Tramo sent: `<chargeId>.<attempt>`.
  readonly reference: string;
  // The provider's id of the payment, which must be the one it accepted for the attempt.
  readonly paymentId: string;
  readonly outcome: 'succeeded' | 'failed';
  readonly failureReason: string | null;
}

export class RecordPaymentResultCommand extends Command<{
  readonly id: string;
  readonly status: ChargeStatus;
}> {
  constructor(readonly result: PaymentResult) {
    super();
  }
}

// Providers deliver callbacks at least once: a repeated one writes nothing.
@CommandHandler(RecordPaymentResultCommand)
export class RecordPaymentResultHandler implements ICommandHandler<RecordPaymentResultCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(
    command: RecordPaymentResultCommand,
  ): Promise<{ readonly id: string; readonly status: ChargeStatus }> {
    const { reference, paymentId, outcome, failureReason } = command.result;
    const chargeId = reference.slice(0, reference.lastIndexOf('.'));
    return this.uow.run(async () => {
      const charge = chargeId ? await this.charges.findById(chargeId) : null;
      if (!charge) {
        throw new UnknownCollectionAttemptError(reference);
      }
      const before = charge.status;
      const now = this.clock.now();
      charge.recordAccepted(reference, paymentId);
      if (outcome === 'succeeded') {
        const others = await this.charges.hasOtherChargesInArrears(charge.contractId, charge.id);
        charge.recordSucceeded(reference, now, others);
      } else {
        charge.recordFailed(reference, failureReason ?? '', CalendarDate.fromInstant(now), now);
      }
      if (charge.hasPendingEvents || charge.status !== before) {
        await this.charges.save(charge);
        this.audit.describeChanges({ status: { before, after: charge.status } });
      }
      return { id: charge.id, status: charge.status };
    });
  }
}
