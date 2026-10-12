import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CalendarDate, CLOCK, type Clock, Money } from '@shared/domain';

import {
  Charge,
  CHARGE_REPOSITORY,
  type ChargeRepository,
  INCOME_DECLARATION_REPOSITORY,
  type IncomeDeclarationRepository,
} from '../../domain';
import { type BillablePlan, REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

const PAGE = 100;
// An ISA month of income is charged on the 5th of the month after it.
export const ISA_DUE_DAY = 5;

export interface BillingCycleResult {
  readonly plansBilled: number;
  readonly chargesCreated: number;
  // Plans whose billing failed (and was rolled back); the next run tries them again.
  readonly failedContractIds: readonly string[];
}

// The monthly cycle, as of a day (the 1st in production, any day for a demo): for every plan
// being repaid, a charge for each instalment falling due by the end of that month and not
// charged yet, and for an ISA each month of income up to the previous one, assessed by lending's
// rules on what the student declared. Each plan in its own transaction; charges are unique per
// contract and reference, so a second run of the same month creates nothing.
export class RunBillingCycleCommand extends Command<BillingCycleResult> {
  constructor(readonly asOf: CalendarDate) {
    super();
  }
}

@CommandHandler(RunBillingCycleCommand)
export class RunBillingCycleHandler implements ICommandHandler<RunBillingCycleCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(INCOME_DECLARATION_REPOSITORY)
    private readonly declarations: IncomeDeclarationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RunBillingCycleCommand): Promise<BillingCycleResult> {
    let plansBilled = 0;
    let chargesCreated = 0;
    const failedContractIds: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await this.plans.billablePlans(after, PAGE);
      for (const plan of page) {
        try {
          chargesCreated += await this.uow.run(() => this.bill(plan, command.asOf));
          plansBilled += 1;
        } catch {
          failedContractIds.push(plan.contractId);
        }
      }
      if (page.length < PAGE) {
        return { plansBilled, chargesCreated, failedContractIds };
      }
      after = page.at(-1)?.contractId ?? null;
    }
  }

  private async bill(plan: BillablePlan, asOf: CalendarDate): Promise<number> {
    return plan.kind === 'installments'
      ? this.billInstallments(plan, asOf)
      : this.billIncomeShare(plan, asOf);
  }

  private async billInstallments(plan: BillablePlan, asOf: CalendarDate): Promise<number> {
    const endOfMonth = asOf.startOfMonth().addMonths(1).addDays(-1);
    let created = 0;
    for (const row of plan.unpaidInstallments) {
      const dueDate = CalendarDate.parse(row.dueDate);
      if (dueDate.isAfter(endOfMonth)) {
        break;
      }
      created += await this.create(plan, {
        kind: 'installment',
        reference: `installment:${String(row.number)}`,
        installmentNumber: row.number,
        period: dueDate.period,
        amount: Money.fromCents(row.totalCents),
        dueDate,
      });
    }
    return created;
  }

  // Every month of income that has ended and lending has not assessed yet, in order.
  private async billIncomeShare(plan: BillablePlan, asOf: CalendarDate): Promise<number> {
    let created = 0;
    let period = plan.nextIsaPeriod;
    while (period !== null && period < asOf.period) {
      const declaration = await this.declarations.findByPeriod(plan.contractId, period);
      const assessment = await this.plans.assessIsaPeriod(
        plan.contractId,
        period,
        declaration?.grossMonthlyIncome.cents ?? null,
      );
      if (assessment.outcome === 'ended') {
        break;
      }
      const month = CalendarDate.parse(`${period}-01`);
      if (assessment.outcome === 'charge' && assessment.amountCents > 0) {
        created += await this.create(plan, {
          kind: 'isa',
          reference: `isa:${period}`,
          installmentNumber: null,
          period,
          amount: Money.fromCents(assessment.amountCents),
          dueDate: month.addMonths(1).withDay(ISA_DUE_DAY),
        });
      }
      period = month.addMonths(1).period;
    }
    return created;
  }

  private async create(
    plan: BillablePlan,
    charge: Pick<
      Parameters<typeof Charge.create>[0],
      'kind' | 'reference' | 'installmentNumber' | 'period' | 'amount' | 'dueDate'
    >,
  ): Promise<number> {
    if (await this.charges.findByReference(plan.contractId, charge.reference)) {
      return 0;
    }
    await this.charges.save(
      Charge.create({
        id: uuidv7(),
        contractId: plan.contractId,
        studentId: plan.studentId,
        centerId: plan.centerId,
        ...charge,
        now: this.clock.now(),
      }),
    );
    return 1;
  }
}
