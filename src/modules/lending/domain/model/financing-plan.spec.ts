import { CalendarDate, InvalidValueError, Money, Percentage } from '@shared/domain';

import { aPlan, anIsa, LATER } from '../../../../../test/factories/lending';
import {
  PayoffAlreadyRequestedError,
  PayoffNotAvailableError,
  PeriodAlreadyAssessedError,
  PlanEndedError,
} from '../errors/lending-errors';
import { LendingEvents } from '../events/lending-events';

import { FinancingPlan, type IsaPlanTerms } from './financing-plan';

const eur = (amount: string): Money => Money.fromDecimal(amount);
const month = (period: string): CalendarDate => CalendarDate.parse(`${period}-01`);
const eventTypes = (plan: FinancingPlan): string[] =>
  plan.pullEvents().map((event) => event.eventType);
const isa = (plan: FinancingPlan): IsaPlanTerms => plan.terms as IsaPlanTerms;

describe('FinancingPlan', () => {
  it('should be reconstituted as it was saved, without events', () => {
    const plan = aPlan();
    plan.pullEvents();

    const loaded = FinancingPlan.reconstitute(plan.id, {
      contractId: plan.contractId,
      studentId: plan.studentId,
      centerId: plan.centerId,
      principal: plan.principal,
      startsOn: plan.startsOn,
      terms: plan.terms,
      status: plan.status,
      completionReason: plan.completionReason,
      completedAt: plan.completedAt,
      createdAt: plan.createdAt,
    });

    expect(loaded).toMatchObject({
      contractId: plan.contractId,
      studentId: plan.studentId,
      centerId: plan.centerId,
      createdAt: plan.createdAt,
      completedAt: null,
    });
    expect(loaded.hasPendingEvents).toBe(false);
  });

  describe('instalments', () => {
    it('should open with the table of the contract, from the month after activation', () => {
      const plan = aPlan({ activatedOn: '2026-10-12' });

      expect(plan.status).toBe('active');
      expect(plan.terms.kind).toBe('installments');
      if (plan.terms.kind !== 'installments') return;
      expect(plan.terms.schedule).toHaveLength(24);
      expect(plan.terms.schedule[0]?.dueDate.toString()).toBe('2026-11-12');
      expect(plan.terms.schedule[0]?.total).toEqual(eur('337.50'));
      expect(plan.terms.schedule.at(-1)?.dueDate.toString()).toBe('2028-10-12');
    });

    it('should quote a payoff and record the request once', () => {
      const plan = aPlan({ activatedOn: '2026-10-12' });

      const quote = plan.requestPayoff(CalendarDate.parse('2026-10-12'), LATER);

      expect(quote.total).toEqual(eur('7500.00'));
      expect(plan.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: LendingEvents.PayoffRequested,
          payload: expect.objectContaining({ amountCents: 7_500_00, asOf: '2026-10-12' }),
        }),
      ]);
      expect(() => plan.requestPayoff(CalendarDate.parse('2026-10-13'), LATER)).toThrow(
        PayoffAlreadyRequestedError,
      );
    });

    it('should not quote a payoff before the plan starts', () => {
      expect(() =>
        aPlan({ activatedOn: '2026-10-12' }).payoffQuote(CalendarDate.parse('2026-10-11')),
      ).toThrow(InvalidValueError);
    });

    it('should end when the payoff is collected, and not before it is requested', () => {
      const plan = aPlan();
      expect(() => {
        plan.settlePayoff(LATER);
      }).toThrow(PayoffNotAvailableError);
      plan.requestPayoff(plan.startsOn, LATER);
      plan.pullEvents();

      plan.settlePayoff(LATER);

      expect(plan).toMatchObject({ status: 'completed', completionReason: 'paid_off' });
      expect(eventTypes(plan)).toEqual([LendingEvents.PlanCompleted]);
      expect(() => plan.payoffQuote(plan.startsOn)).toThrow(PlanEndedError);
    });

    it('should count instalments paid in order, ignore repeats and end with the last', () => {
      const plan = aPlan({
        product: { kind: 'installments', termMonths: 6, annualRate: Percentage.fromPercent(9) },
      });

      plan.recordInstallmentPaid(1, LATER);
      plan.recordInstallmentPaid(1, LATER);
      expect(() => {
        plan.recordInstallmentPaid(3, LATER);
      }).toThrow(InvalidValueError);
      for (const number of [2, 3, 4, 5, 6]) plan.recordInstallmentPaid(number, LATER);

      expect(plan).toMatchObject({ status: 'completed', completionReason: 'repaid' });
      expect(eventTypes(plan)).toEqual([LendingEvents.PlanCompleted]);
    });

    it('should not be assessed by income', () => {
      expect(() => aPlan().assessPeriod(month('2027-01'), eur('2000.00'), LATER)).toThrow(
        InvalidValueError,
      );
    });
  });

  describe('income share agreement', () => {
    // Activated 5 January 2026 for a 12 week program: it ends on 30 March. Three months of grace
    // reach 30 June, so July 2026 is the first month charged; the window ends 30 March 2034.
    const anIsaPlan = (overrides: Parameters<typeof anIsa>[0] = {}) =>
      aPlan({ product: anIsa(overrides), activatedOn: '2026-01-05', durationWeeks: 12 });

    it('should open with its cap, first month and window', () => {
      const terms = isa(anIsaPlan());

      expect(terms.cap).toEqual(eur('11250.00'));
      expect(terms.firstPeriod.toString()).toBe('2026-07-01');
      expect(terms.windowEndsOn.toString()).toBe('2034-03-30');
    });

    it('should charge nothing before the first month, without counting it', () => {
      const plan = anIsaPlan();

      expect(plan.assessPeriod(month('2026-06'), null, LATER)).toEqual({ outcome: 'not_started' });
      expect(isa(plan).consecutiveMissingDeclarations).toBe(0);
      expect(isa(plan).lastAssessedPeriod).toBeNull();
    });

    it('should charge the share of an income exactly at the threshold', () => {
      const plan = anIsaPlan();

      expect(plan.assessPeriod(month('2026-07'), eur('1500.00'), LATER)).toEqual({
        outcome: 'charge',
        amount: eur('150.00'),
      });
      expect(isa(plan)).toMatchObject({ chargedSoFar: eur('150.00'), paymentsMade: 1 });
    });

    it('should pause a month of unemployment: nothing owed, no payment counted', () => {
      const plan = anIsaPlan();

      expect(plan.assessPeriod(month('2026-07'), eur('0.00'), LATER)).toEqual({
        outcome: 'paused',
        reason: 'below_threshold',
      });
      expect(plan.assessPeriod(month('2026-08'), eur('1499.99'), LATER)).toEqual({
        outcome: 'paused',
        reason: 'below_threshold',
      });
      expect(isa(plan)).toMatchObject({ chargedSoFar: eur('0.00'), paymentsMade: 0 });
    });

    it('should charge only what is left of the cap in the month it is reached, and end', () => {
      // Cap at the 7,500 principal; 10 % of 30,000 is 3,000 a month.
      const plan = anIsaPlan({ capMultiplierHundredths: 100 });

      plan.assessPeriod(month('2026-07'), eur('30000.00'), LATER);
      plan.assessPeriod(month('2026-08'), eur('30000.00'), LATER);
      plan.pullEvents();
      const third = plan.assessPeriod(month('2026-09'), eur('30000.00'), LATER);

      expect(third).toEqual({ outcome: 'charge', amount: eur('1500.00') });
      expect(plan).toMatchObject({ status: 'completed', completionReason: 'cap_reached' });
      expect(plan.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: LendingEvents.PlanCompleted,
          payload: expect.objectContaining({ reason: 'cap_reached' }),
        }),
      ]);
      expect(() => plan.assessPeriod(month('2026-10'), eur('30000.00'), LATER)).toThrow(
        PlanEndedError,
      );
    });

    it('should end with the last payment allowed', () => {
      const plan = anIsaPlan({ maxPayments: 2 });

      plan.assessPeriod(month('2026-07'), eur('2000.00'), LATER);
      plan.assessPeriod(month('2026-08'), eur('1000.00'), LATER);
      plan.assessPeriod(month('2026-09'), eur('2000.00'), LATER);

      expect(plan).toMatchObject({ status: 'completed', completionReason: 'max_payments' });
      expect(isa(plan)).toMatchObject({ paymentsMade: 2, chargedSoFar: eur('400.00') });
    });

    it('should end, charging nothing, once a month starts after the window', () => {
      const plan = anIsaPlan();
      plan.assessPeriod(month('2026-07'), eur('2000.00'), LATER);

      expect(plan.assessPeriod(month('2034-03'), eur('2000.00'), LATER)).toEqual({
        outcome: 'charge',
        amount: eur('200.00'),
      });
      expect(plan.assessPeriod(month('2034-04'), eur('2000.00'), LATER)).toEqual({
        outcome: 'ended',
      });
      expect(plan).toMatchObject({ status: 'completed', completionReason: 'window_expired' });
      expect(isa(plan).chargedSoFar).toEqual(eur('400.00'));
    });

    it('should mark declarations overdue after two months without one, and clear it with the next', () => {
      const plan = anIsaPlan();

      expect(plan.assessPeriod(month('2026-07'), null, LATER)).toEqual({
        outcome: 'paused',
        reason: 'no_declaration',
      });
      expect(eventTypes(plan)).toEqual([]);
      plan.assessPeriod(month('2026-08'), null, LATER);
      expect(isa(plan).declarationOverdue).toBe(true);
      expect(plan.pullEvents()).toEqual([
        expect.objectContaining({
          eventType: LendingEvents.IsaDeclarationOverdue,
          payload: expect.objectContaining({ missingSince: '2026-07' }),
        }),
      ]);
      plan.assessPeriod(month('2026-09'), null, LATER);
      expect(eventTypes(plan)).toEqual([]);

      plan.assessPeriod(month('2026-10'), eur('1000.00'), LATER);

      expect(isa(plan)).toMatchObject({
        declarationOverdue: false,
        consecutiveMissingDeclarations: 0,
      });
    });

    it('should assess each month once, in order', () => {
      const plan = anIsaPlan();
      plan.assessPeriod(month('2026-08'), eur('2000.00'), LATER);

      expect(() => plan.assessPeriod(month('2026-08'), eur('2000.00'), LATER)).toThrow(
        PeriodAlreadyAssessedError,
      );
      expect(() => plan.assessPeriod(month('2026-07'), eur('2000.00'), LATER)).toThrow(
        PeriodAlreadyAssessedError,
      );
    });

    it('should have no payoff', () => {
      expect(() => anIsaPlan().payoffQuote(CalendarDate.parse('2026-02-01'))).toThrow(
        PayoffNotAvailableError,
      );
    });
  });
});
