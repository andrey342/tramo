import { Inject, Logger } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  type FinancingPlan,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';

// Billing collected a charge (ChargePaid): an instalment of the table, or the payoff; could not
// collect a payoff (ChargeFailed), which is withdrawn; or the student's bank returned a payment
// it had collected (ChargeReturned). An ISA charge needs nothing more, its amount counted when the
// month was assessed.
export type Repayment =
  | {
      readonly kind: 'installment';
      readonly installmentNumber: number;
      // The collection attempt that paid it (absent in notices recorded before it was sent).
      readonly attempt?: number;
    }
  | {
      readonly kind: 'installment_returned';
      readonly installmentNumber: number;
      readonly attempt?: number;
    }
  | { readonly kind: 'payoff' }
  | { readonly kind: 'payoff_returned' }
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
  private readonly logger = new Logger(RecordRepaymentHandler.name);

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
      // A redelivered payment changes nothing, and writes nothing.
      if (alreadyRecorded(plan, repayment)) {
        return;
      }
      if (!takes(plan, repayment)) {
        // A plan that ended repaid or paid off is not reopened (ADR 020): billing duns the charge
        // returned as any other, and ops settle the rest with the student.
        if (repayment.kind === 'installment_returned' || repayment.kind === 'payoff_returned') {
          this.logger.warn(
            { contractId: plan.contractId, planId: plan.id, reason: plan.completionReason },
            'Payment returned on a plan that has ended; the plan stays as it ended',
          );
        }
        return;
      }
      const now = this.clock.now();
      switch (repayment.kind) {
        case 'installment':
          plan.recordInstallmentPaid(repayment.installmentNumber, now, repayment.attempt ?? null);
          break;
        case 'installment_returned':
          plan.recordInstallmentReturned(repayment.installmentNumber, repayment.attempt ?? null);
          break;
        case 'payoff':
          plan.settlePayoff(now);
          break;
        default:
          plan.withdrawPayoff(now);
      }
      await this.plans.save(plan);
    });
  }
}

// What the plan, as it is now, records. Payments and returns of instalments also once defaulted,
// since the debt is still being recovered (a plan paid off while an instalment was in collection
// has nothing left to record); a payoff only while active. A payoff paid back by the bank finds
// the plan paid off: it is never reopened.
function takes(plan: FinancingPlan, repayment: Repayment): boolean {
  switch (repayment.kind) {
    case 'installment':
    case 'installment_returned':
      return plan.recordsRepayments;
    case 'payoff_returned':
      return false;
    default:
      return plan.status === 'active';
  }
}

function alreadyRecorded(plan: FinancingPlan, repayment: Repayment): boolean {
  switch (repayment.kind) {
    case 'payoff':
      return plan.completionReason === 'paid_off';
    case 'payoff_failed':
      return plan.terms.kind !== 'installments' || plan.terms.payoffRequest === null;
    case 'installment':
      return (
        plan.terms.kind === 'installments' &&
        plan.terms.paidInstallments.includes(repayment.installmentNumber)
      );
    default:
      // Each return is a notice of its own, delivered once (consumers deduplicate on the event).
      return false;
  }
}
