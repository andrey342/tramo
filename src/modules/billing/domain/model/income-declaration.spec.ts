import { uuidv7 } from 'uuidv7';

import { CalendarDate, InvalidValueError, Money } from '@shared/domain';

import { aDeclaration, NOW } from '../../../../../test/factories/billing';
import {
  ConcurrentChargeError,
  InvalidPeriodError,
  PeriodNotOpenError,
} from '../errors/billing-errors';
import { BillingEvents } from '../events/billing-events';

import { firstDeclarablePeriod, IncomeDeclaration, isaPeriodClosesOn } from './income-declaration';

const declare = (
  period: string,
  incomeCents = 2_000_00,
  { now = NOW, openFrom = null }: { now?: Date; openFrom?: string | null } = {},
) =>
  IncomeDeclaration.declare({
    id: uuidv7(),
    contractId: uuidv7(),
    studentId: uuidv7(),
    period,
    grossMonthlyIncome: Money.fromCents(incomeCents),
    source: 'self',
    openFrom,
    now,
  });

describe('IncomeDeclaration', () => {
  it('should declare a past or current month, announcing it without the amount', () => {
    const declaration = aDeclaration({ period: '2026-11', incomeCents: 2_345_67 });

    const [event] = declaration.pullEvents();
    expect(event).toMatchObject({
      eventType: BillingEvents.IncomeDeclared,
      payload: { period: '2026-11' },
    });
    expect(JSON.stringify(event?.payload)).not.toContain('234567');
  });

  it.each(['2026-12', '2026-13', '2026-1', 'november'])('should refuse the period %s', (period) => {
    expect(() => declare(period)).toThrow(InvalidPeriodError);
  });

  it('should be reconstituted as saved', () => {
    const declaration = aDeclaration();

    const loaded = IncomeDeclaration.reconstitute(declaration.id, {
      contractId: declaration.contractId,
      studentId: declaration.studentId,
      period: declaration.period,
      grossMonthlyIncome: declaration.grossMonthlyIncome,
      source: declaration.source,
      declaredAt: declaration.declaredAt,
    });

    expect(loaded).toMatchObject({
      studentId: declaration.studentId,
      source: 'self',
      declaredAt: NOW,
    });
  });

  it('should accept no income and refuse a negative one', () => {
    expect(declare('2026-11', 0).grossMonthlyIncome.isZero()).toBe(true);
    expect(() => declare('2026-11', -1)).toThrow(InvalidValueError);
  });

  it('should take the previous month until the end of the 4th when its salary came late', () => {
    const fourth = new Date('2026-12-04T23:59:59Z');

    expect(declare('2026-11', 2_000_00, { now: fourth }).period).toBe('2026-11');
    expect(declare('2026-12', 2_000_00, { now: fourth }).period).toBe('2026-12');
    expect(() => declare('2026-10', 2_000_00, { now: fourth })).toThrow(PeriodNotOpenError);
  });

  it('should refuse the previous month from the 5th, naming the first open one', () => {
    expect(() => declare('2026-10', 2_000_00, { now: new Date('2026-11-05T00:00:00Z') })).toThrow(
      expect.objectContaining({
        code: 'period_not_open',
        details: expect.objectContaining({ openFrom: '2026-11' }),
      }),
    );
  });

  it('should refuse a month lending has assessed even while its window is open', () => {
    const third = new Date('2026-12-03T10:00:00Z');

    expect(() => declare('2026-11', 2_000_00, { now: third, openFrom: '2026-12' })).toThrow(
      expect.objectContaining({ details: expect.objectContaining({ openFrom: '2026-12' }) }),
    );
    expect(declare('2026-11', 2_000_00, { now: third, openFrom: '2026-07' }).period).toBe(
      '2026-11',
    );
  });
});

describe('ISA declaration window', () => {
  it.each([
    ['2026-10', '2026-11-05'],
    ['2026-12', '2027-01-05'],
    ['2027-01', '2027-02-05'],
  ])('should close %s on %s, the day it is assessed and falls due', (period, closesOn) => {
    expect(isaPeriodClosesOn(period).toString()).toBe(closesOn);
  });

  it.each([
    ['2026-11-01', '2026-10'],
    ['2026-11-04', '2026-10'],
    ['2026-11-05', '2026-11'],
    ['2027-01-02', '2026-12'],
  ])('should leave open from the month before on %s, the first being %s', (today, first) => {
    expect(firstDeclarablePeriod(CalendarDate.parse(today))).toBe(first);
  });
});

describe('ConcurrentChargeError', () => {
  it('should name the charge another run created', () => {
    expect(new ConcurrentChargeError('installment:3')).toMatchObject({
      code: 'concurrent_charge',
      category: 'conflict',
      details: { reference: 'installment:3' },
    });
  });
});
