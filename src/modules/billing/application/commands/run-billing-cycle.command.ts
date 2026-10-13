import { Inject, Logger } from '@nestjs/common';
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
  isaPeriodClosesOn,
} from '../../domain';
import { type BillablePlan, REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

const PAGE = 100;

export interface BillingCycleResult {
  readonly plansBilled: number;
  readonly chargesCreated: number;
  // Plans whose billing failed (and was rolled back); the next run tries them again.
  readonly failedContractIds: readonly string[];
}

// The monthly cycle, as of a day (the 1st and the 5th in production, any day for a demo): for
// every plan being repaid (one contract's, when given), a charge for each instalment falling due
// by the end of that month and not charged yet, and for an ISA each month of income whose
// declarations have closed (on the 5th of the next month), assessed by lending's rules on what
// the student declared, until one ends the plan. Each plan
// in its own transaction; charges are unique per contract and reference, so a second run of the
// same month creates nothing. A charge caught up late is due on the day of the run, not before:
// dunning counts from when the student could have paid.
export class RunBillingCycleCommand extends Command<BillingCycleResult> {
  constructor(
    readonly asOf: CalendarDate,
    readonly contractId: string | null = null,
  ) {
    super();
  }
}

@CommandHandler(RunBillingCycleCommand)
export class RunBillingCycleHandler implements ICommandHandler<RunBillingCycleCommand> {
  private readonly logger = new Logger(RunBillingCycleHandler.name);

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
      const page = await this.plans.billablePlans(after, PAGE, command.contractId);
      for (const plan of page) {
        try {
          chargesCreated += await this.uow.run(() => this.bill(plan, command.asOf));
          plansBilled += 1;
        } catch (error) {
          failedContractIds.push(plan.contractId);
          this.logger.error({ contractId: plan.contractId, err: error }, 'Plan not billed');
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
        dueDate: latest(dueDate, asOf),
      });
    }
    return created;
  }

  // Every month of income whose declarations have closed and lending has not assessed yet, in
  // order; under the contract's lock, so the declarations read are the last ones. The plan is
  // read again under the lock too: the page was read before it, and a run at the same time may
  // have assessed months since, or ended the plan. A month is due on the day its declarations
  // close, or on the day of the run when billed late.
  private async billIncomeShare(plan: BillablePlan, asOf: CalendarDate): Promise<number> {
    await this.charges.lockContract(plan.contractId);
    const [current] = await this.plans.billablePlans(null, 1, plan.contractId);
    let created = 0;
    let period = current?.nextIsaPeriod ?? null;
    while (period !== null) {
      const closesOn = isaPeriodClosesOn(period);
      if (asOf.isBefore(closesOn)) {
        break;
      }
      const declaration = await this.declarations.findByPeriod(plan.contractId, period);
      const assessment = await this.plans.assessIsaPeriod(
        plan.contractId,
        period,
        declaration?.grossMonthlyIncome.cents ?? null,
      );
      if (assessment.outcome === 'charge' && assessment.amountCents > 0) {
        created += await this.create(plan, {
          kind: 'isa',
          reference: `isa:${period}`,
          installmentNumber: null,
          period,
          amount: Money.fromCents(assessment.amountCents),
          dueDate: latest(closesOn, asOf),
        });
      }
      // The cap, the last payment or the window: lending has closed the plan.
      if (assessment.planEnded) {
        break;
      }
      period = CalendarDate.parse(`${period}-01`).addMonths(1).period;
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

function latest(dueDate: CalendarDate, asOf: CalendarDate): CalendarDate {
  return dueDate.isBefore(asOf) ? asOf : dueDate;
}
