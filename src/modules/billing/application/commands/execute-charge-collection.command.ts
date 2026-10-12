import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
} from '../../domain';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../ports/billing-ports';

// Asks the payment provider to collect one attempt. Run by a job after ChargeSubmitted.
export class ExecuteChargeCollectionCommand extends Command<void> {
  constructor(
    readonly chargeId: string,
    readonly attemptKey: string,
  ) {
    super();
  }
}

@CommandHandler(ExecuteChargeCollectionCommand)
export class ExecuteChargeCollectionHandler implements ICommandHandler<ExecuteChargeCollectionCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
  ) {}

  async execute(command: ExecuteChargeCollectionCommand): Promise<void> {
    const charge = await this.charges.findById(command.chargeId);
    const attempt = charge?.currentAttempt;
    // Answered already, superseded by a later attempt, or accepted by the provider: done.
    if (
      !charge ||
      attempt?.key !== command.attemptKey ||
      attempt.outcome !== 'pending' ||
      attempt.paymentId
    ) {
      return;
    }
    // The mandate the attempt started with, even if replaced since: the request is the same on
    // every run, and a mandate revoked at the bank comes back as a failure.
    const mandate = await this.mandates.findById(attempt.mandateId);
    if (!mandate) {
      throw new Error(`Mandate ${attempt.mandateId} of charge ${charge.id} does not exist.`);
    }
    // Outside any transaction; idempotent by key.
    const { paymentId } = await this.gateway.collect({
      idempotencyKey: attempt.key,
      amount: charge.amount,
      mandateReference: mandate.reference,
      debtorIban: mandate.iban.value,
      description: `Tramo ${charge.reference} ${charge.contractId}`,
    });
    await this.uow.run(async () => {
      const fresh = await this.charges.findById(command.chargeId);
      if (fresh?.currentAttempt?.key !== command.attemptKey) {
        return;
      }
      fresh.recordAccepted(command.attemptKey, paymentId);
      await this.charges.save(fresh);
    });
  }
}
