import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  type FinancingPlan,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';

// Billing collected a charge (ChargePaid): an instalment of the table, or the payoff; or could
// not collect a payoff (ChargeFailed), which is withdrawn. An ISA charge needs nothing more, its
// amount counted when the month was assessed.
export type Repayment =
  | { readonly kind: 'installment'; readonly installmentNumber: number }
  | { readonly kind: 'payoff' }
  | { readonly kind: 'payoff_failed' };

export class RecordRepaymentCommand extends Command<void> {
  constructor(
    readonly contractId: string,
    readonly repayment: Repayment,
  ) {
    super();
  }
}

@CommandHandler(RecordRepaymentCommand)
export class RecordRepaymentHandler implements ICommandHandler<RecordRepaymentCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RecordRepaymentCommand): Promise<void> {
    const { repayment } = command;
    await this.uow.run(async () => {
      const plan = await this.plans.findByContractId(command.contractId);
      if (!plan) {
        throw new EntityNotFoundError('FinancingPlan', command.contractId);
      }
      // A redelivered payment changes nothing, and writes nothing. A plan that has ended (paid
      // off while an instalment was in collection) has nothing left to record either.
      if (alreadyRecorded(plan, repayment) || plan.status !== 'active') {
        return;
      }
      const now = this.clock.now();
      if (repayment.kind === 'installment') {
        plan.recordInstallmentPaid(repayment.installmentNumber, now);
      } else if (repayment.kind === 'payoff') {
        plan.settlePayoff(now);
      } else {
        plan.withdrawPayoff(now);
      }
      await this.plans.save(plan);
    });
  }
}

function alreadyRecorded(plan: FinancingPlan, repayment: Repayment): boolean {
  if (repayment.kind === 'payoff') {
    return plan.completionReason === 'paid_off';
  }
  if (repayment.kind === 'payoff_failed') {
    return plan.terms.kind !== 'installments' || plan.terms.payoffRequest === null;
  }
  return (
    plan.terms.kind === 'installments' &&
    plan.terms.paidInstallments.includes(repayment.installmentNumber)
  );
}
