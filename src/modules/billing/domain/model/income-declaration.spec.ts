import { uuidv7 } from 'uuidv7';

import { InvalidValueError, Money } from '@shared/domain';

import { aDeclaration, NOW } from '../../../../../test/factories/billing';
import { InvalidPeriodError } from '../errors/billing-errors';
import { BillingEvents } from '../events/billing-events';

import { IncomeDeclaration } from './income-declaration';

const declare = (period: string, incomeCents = 2_000_00) =>
  IncomeDeclaration.declare({
    id: uuidv7(),
    contractId: uuidv7(),
    studentId: uuidv7(),
    period,
    grossMonthlyIncome: Money.fromCents(incomeCents),
    source: 'self',
    now: NOW,
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

  it('should accept no income and refuse a negative one', () => {
    expect(declare('2026-10', 0).grossMonthlyIncome.isZero()).toBe(true);
    expect(() => declare('2026-10', -1)).toThrow(InvalidValueError);
  });
});
