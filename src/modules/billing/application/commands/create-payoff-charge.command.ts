import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { type CalendarDate, CLOCK, type Clock, EntityNotFoundError, Money } from '@shared/domain';

import {
  Charge,
  CHARGE_REPOSITORY,
  type ChargeRepository,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
} from '../../domain';
import { REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

export interface PayoffRequest {
  // The request (lending's PayoffRequested event): a payoff refused and asked for again is a new
  // charge.
  readonly requestId: string;
  readonly planId: string;
  readonly contractId: string;
  readonly amountCents: number;
  readonly asOf: CalendarDate;
}

// The student asked to repay everything (lending's PayoffRequested): one charge for the quoted
// amount, due that day and collected at once; without a mandate it is refused at once and
// lending withdraws it. Once per request. While it
// is collected, nothing else of the contract is (it covers what is left); charges still
// scheduled are cancelled when the plan is paid off, or collected as usual if the bank refuses.
export class CreatePayoffChargeCommand extends Command<void> {
  constructor(readonly payoff: PayoffRequest) {
    super();
  }
}

@CommandHandler(CreatePayoffChargeCommand)
export class CreatePayoffChargeHandler implements ICommandHandler<CreatePayoffChargeCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CreatePayoffChargeCommand): Promise<void> {
    const { payoff } = command;
    const reference = `payoff:${payoff.requestId}`;
    await this.uow.run(async () => {
      // Under the contract's lock, so a collection deciding whether a payoff exists waits for it.
      await this.charges.lockContract(payoff.contractId);
      if (await this.charges.findByReference(payoff.contractId, reference)) {
        return;
      }
      const contract = await this.plans.findContract(payoff.contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', payoff.contractId);
      }
      const now = this.clock.now();
      const charge = Charge.create({
        id: uuidv7(),
        contractId: contract.id,
        studentId: contract.studentId,
        centerId: contract.centerId,
        kind: 'payoff',
        reference,
        installmentNumber: null,
        period: payoff.asOf.period,
        amount: Money.fromCents(payoff.amountCents),
        dueDate: payoff.asOf,
        now,
      });
      // A payoff covers what is not overdue; charges past due are collected first. Lending checks
      // it against today's schedule, billing against the charges dunning has made overdue (as of
      // a run on a day to come, where future runs are enabled). One that failed before its due
      // date is still covered.
      const owed = (await this.charges.findOpen(contract.id)).some(
        (open) => open.status === 'overdue',
      );
      const mandate = await this.mandates.findActiveByContract(contract.id);
      if (owed) {
        charge.refusePayoff('charges_overdue', now);
      } else if (mandate) {
        charge.submitCollection(mandate.id, now);
      } else {
        charge.refusePayoff('no_mandate', now);
      }
      await this.charges.save(charge);
    });
  }
}
