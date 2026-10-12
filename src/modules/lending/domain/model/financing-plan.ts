import {
  AggregateRoot,
  type CalendarDate,
  InvalidValueError,
  Money,
  type Percentage,
} from '@shared/domain';

import {
  PayoffAlreadyRequestedError,
  PayoffNotAvailableError,
  PeriodAlreadyAssessedError,
  PlanEndedError,
} from '../errors/lending-errors';
import { LendingEvents, type PlanCompletedPayload } from '../events/lending-events';

import { type ContractProduct, isaCap } from './contract-terms';
import {
  amortizationSchedule,
  firstDueDate,
  type InstallmentRow,
  payoffQuote,
  type PayoffQuote,
} from './installment-schedule';
import { firstIsaPeriod, isaWindowEnd, programEnd } from './isa-rules';

export type PlanStatus = 'active' | 'completed';
export type CompletionReason = PlanCompletedPayload['reason'];

export interface PayoffRequest {
  readonly amount: Money;
  readonly asOf: CalendarDate;
  readonly requestedAt: Date;
}

export interface InstallmentPlanTerms {
  readonly kind: 'installments';
  readonly annualRate: Percentage;
  readonly termMonths: number;
  readonly schedule: readonly InstallmentRow[];
  // Paid in order, as billing collects them.
  readonly installmentsPaid: number;
  readonly payoffRequest: PayoffRequest | null;
}

export interface IsaPlanTerms {
  readonly kind: 'isa';
  readonly incomeShare: Percentage;
  readonly minMonthlyIncome: Money;
  readonly maxPayments: number;
  readonly cap: Money;
  // The first day of the first month that can be charged.
  readonly firstPeriod: CalendarDate;
  readonly windowEndsOn: CalendarDate;
  // Charged towards the cap so far, and in how many months.
  readonly chargedSoFar: Money;
  readonly paymentsMade: number;
  readonly consecutiveMissingDeclarations: number;
  readonly declarationOverdue: boolean;
  readonly lastAssessedPeriod: CalendarDate | null;
}

export interface FinancingPlanProps {
  readonly contractId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly principal: Money;
  readonly startsOn: CalendarDate;
  readonly terms: InstallmentPlanTerms | IsaPlanTerms;
  readonly status: PlanStatus;
  readonly completionReason: CompletionReason | null;
  readonly completedAt: Date | null;
  readonly createdAt: Date;
}

// What one month of an ISA comes to. Nothing is owed for a paused month.
export type IsaAssessment =
  | { readonly outcome: 'charge'; readonly amount: Money }
  | { readonly outcome: 'paused'; readonly reason: 'no_declaration' | 'below_threshold' }
  | { readonly outcome: 'not_started' }
  | { readonly outcome: 'ended' };

const OVERDUE_AFTER_MISSING = 2;

// How an active contract is repaid: a fixed instalment table, or an income share agreement whose
// charges depend on what the graduate earns each month.
export class FinancingPlan extends AggregateRoot {
  private constructor(
    id: string,
    private props: FinancingPlanProps,
  ) {
    super(id);
  }

  static open(input: {
    id: string;
    contractId: string;
    studentId: string;
    centerId: string;
    principal: Money;
    product: ContractProduct;
    programDurationWeeks: number;
    activatedOn: CalendarDate;
    now: Date;
  }): FinancingPlan {
    const { product, principal, activatedOn } = input;
    let terms: InstallmentPlanTerms | IsaPlanTerms;
    if (product.kind === 'installments') {
      terms = {
        kind: 'installments',
        annualRate: product.annualRate,
        termMonths: product.termMonths,
        schedule: amortizationSchedule({
          principal,
          annualRate: product.annualRate,
          termMonths: product.termMonths,
          firstDueDate: firstDueDate(activatedOn),
        }),
        installmentsPaid: 0,
        payoffRequest: null,
      };
    } else {
      const end = programEnd(activatedOn, input.programDurationWeeks);
      terms = {
        kind: 'isa',
        incomeShare: product.incomeShare,
        minMonthlyIncome: product.minMonthlyIncome,
        maxPayments: product.maxPayments,
        cap: isaCap(principal, product.capMultiplierHundredths),
        firstPeriod: firstIsaPeriod(end, product.graceMonths),
        windowEndsOn: isaWindowEnd(end),
        chargedSoFar: Money.zero(),
        paymentsMade: 0,
        consecutiveMissingDeclarations: 0,
        declarationOverdue: false,
        lastAssessedPeriod: null,
      };
    }
    return new FinancingPlan(input.id, {
      contractId: input.contractId,
      studentId: input.studentId,
      centerId: input.centerId,
      principal,
      startsOn: activatedOn,
      terms,
      status: 'active',
      completionReason: null,
      completedAt: null,
      createdAt: input.now,
    });
  }

  static reconstitute(id: string, props: FinancingPlanProps): FinancingPlan {
    return new FinancingPlan(id, props);
  }

  get contractId(): string {
    return this.props.contractId;
  }

  get studentId(): string {
    return this.props.studentId;
  }

  get centerId(): string {
    return this.props.centerId;
  }

  get principal(): Money {
    return this.props.principal;
  }

  get startsOn(): CalendarDate {
    return this.props.startsOn;
  }

  get terms(): InstallmentPlanTerms | IsaPlanTerms {
    return this.props.terms;
  }

  get status(): PlanStatus {
    return this.props.status;
  }

  get completionReason(): CompletionReason | null {
    return this.props.completionReason;
  }

  get completedAt(): Date | null {
    return this.props.completedAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // Instalments only: what paying everything off on `asOf` would cost.
  payoffQuote(asOf: CalendarDate): PayoffQuote {
    const terms = this.installmentTerms();
    if (asOf.isBefore(this.props.startsOn)) {
      throw new InvalidValueError('asOf', 'A payoff cannot be quoted before the plan starts.');
    }
    return payoffQuote({
      schedule: terms.schedule,
      principal: this.props.principal,
      annualRate: terms.annualRate,
      startsOn: this.props.startsOn,
      installmentsPaid: terms.installmentsPaid,
      asOf,
    });
  }

  // The student repays everything on `asOf`; billing collects the amount and settlePayoff then
  // ends the plan. One payoff at a time.
  requestPayoff(asOf: CalendarDate, now: Date): PayoffQuote {
    const quote = this.payoffQuote(asOf);
    const terms = this.installmentTerms();
    if (terms.payoffRequest) {
      throw new PayoffAlreadyRequestedError();
    }
    this.props = {
      ...this.props,
      terms: { ...terms, payoffRequest: { amount: quote.total, asOf, requestedAt: now } },
    };
    this.record({
      eventType: LendingEvents.PayoffRequested,
      aggregateType: 'FinancingPlan',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        planId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        amountCents: quote.total.cents,
        asOf: asOf.toString(),
      },
    });
    return quote;
  }

  settlePayoff(now: Date): void {
    const terms = this.installmentTerms();
    if (!terms.payoffRequest) {
      throw new PayoffNotAvailableError('no payoff was requested');
    }
    this.complete('paid_off', now);
  }

  // Instalments are paid in order; a repeated notice of one already counted changes nothing.
  // The last one ends the plan.
  recordInstallmentPaid(number: number, now: Date): void {
    const terms = this.installmentTerms();
    if (number <= terms.installmentsPaid) {
      return;
    }
    if (number !== terms.installmentsPaid + 1) {
      throw new InvalidValueError(
        'installment',
        `Instalment ${String(number)} cannot be paid before instalment ${String(terms.installmentsPaid + 1)}.`,
      );
    }
    this.props = { ...this.props, terms: { ...terms, installmentsPaid: number } };
    if (number === terms.termMonths) {
      this.complete('repaid', now);
    }
  }

  // One billing month of an ISA, assessed in order, given the income the graduate declared for
  // it (null if they did not). At or above the threshold they pay the share of it, never past the
  // cap; below it, or without a declaration, the month is paused and owes nothing. Two months in
  // a row without a declaration mark it overdue, which ops sees. The plan ends at the cap, at the
  // last payment, or once a month starts after the window.
  assessPeriod(period: CalendarDate, declaredIncome: Money | null, now: Date): IsaAssessment {
    const terms = this.isaTerms();
    const month = period.startOfMonth();
    if (terms.lastAssessedPeriod && !month.isAfter(terms.lastAssessedPeriod)) {
      throw new PeriodAlreadyAssessedError(month.period);
    }
    if (month.isBefore(terms.firstPeriod)) {
      return { outcome: 'not_started' };
    }
    if (month.isAfter(terms.windowEndsOn)) {
      this.props = { ...this.props, terms: { ...terms, lastAssessedPeriod: month } };
      this.complete('window_expired', now);
      return { outcome: 'ended' };
    }
    if (!declaredIncome) {
      const missing = terms.consecutiveMissingDeclarations + 1;
      const overdue = missing >= OVERDUE_AFTER_MISSING;
      this.props = {
        ...this.props,
        terms: {
          ...terms,
          consecutiveMissingDeclarations: missing,
          declarationOverdue: overdue,
          lastAssessedPeriod: month,
        },
      };
      if (overdue && !terms.declarationOverdue) {
        this.record({
          eventType: LendingEvents.IsaDeclarationOverdue,
          aggregateType: 'FinancingPlan',
          aggregateId: this.id,
          occurredAt: now,
          payload: {
            planId: this.id,
            contractId: this.props.contractId,
            studentId: this.props.studentId,
            missingSince: month.addMonths(1 - missing).period,
          },
        });
      }
      return { outcome: 'paused', reason: 'no_declaration' };
    }
    const declared = {
      ...terms,
      consecutiveMissingDeclarations: 0,
      declarationOverdue: false,
      lastAssessedPeriod: month,
    };
    if (declaredIncome.lt(terms.minMonthlyIncome)) {
      this.props = { ...this.props, terms: declared };
      return { outcome: 'paused', reason: 'below_threshold' };
    }
    const amount = Money.min(
      declaredIncome.percentage(terms.incomeShare),
      terms.cap.subtract(terms.chargedSoFar),
    );
    const chargedSoFar = terms.chargedSoFar.add(amount);
    const paymentsMade = terms.paymentsMade + 1;
    this.props = { ...this.props, terms: { ...declared, chargedSoFar, paymentsMade } };
    if (chargedSoFar.gte(terms.cap)) {
      this.complete('cap_reached', now);
    } else if (paymentsMade >= terms.maxPayments) {
      this.complete('max_payments', now);
    }
    return { outcome: 'charge', amount };
  }

  private installmentTerms(): InstallmentPlanTerms {
    const { terms } = this.props;
    if (terms.kind !== 'installments') {
      throw new PayoffNotAvailableError('an income share agreement has no instalments');
    }
    this.assertActive();
    return terms;
  }

  private isaTerms(): IsaPlanTerms {
    const { terms } = this.props;
    if (terms.kind !== 'isa') {
      throw new InvalidValueError('plan', 'Only an income share agreement is assessed by income.');
    }
    this.assertActive();
    return terms;
  }

  private assertActive(): void {
    if (this.props.status !== 'active') {
      throw new PlanEndedError(this.id);
    }
  }

  private complete(reason: CompletionReason, now: Date): void {
    this.props = { ...this.props, status: 'completed', completionReason: reason, completedAt: now };
    this.record({
      eventType: LendingEvents.PlanCompleted,
      aggregateType: 'FinancingPlan',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        planId: this.id,
        contractId: this.props.contractId,
        studentId: this.props.studentId,
        centerId: this.props.centerId,
        reason,
      },
    });
  }
}
