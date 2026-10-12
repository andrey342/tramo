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
  readonly planId: string;
  readonly contractId: string;
  readonly amountCents: number;
  readonly asOf: CalendarDate;
}

// The student asked to repay everything (lending's PayoffRequested): one charge for the quoted
// amount, due that day and collected at once when there is a mandate. Once per plan.
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
    const reference = `payoff:${payoff.planId}`;
    await this.uow.run(async () => {
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
      const mandate = await this.mandates.findActiveByContract(contract.id);
      if (mandate) {
        charge.submitCollection(mandate.id, now);
      }
      await this.charges.save(charge);
    });
  }
}
