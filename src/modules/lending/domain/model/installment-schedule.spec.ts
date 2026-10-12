import { CalendarDate, Money, Percentage } from '@shared/domain';

import {
  amortizationSchedule,
  firstDueDate,
  type InstallmentRow,
  payoffQuote,
} from './installment-schedule';

const eur = (amount: string): Money => Money.fromDecimal(amount);
const day = (iso: string): CalendarDate => CalendarDate.parse(iso);

const asTable = (rows: readonly InstallmentRow[]): string[][] =>
  rows.map((row) => [
    String(row.number),
    row.dueDate.toString(),
    row.principal.toDecimalString(),
    row.interest.toDecimalString(),
    row.total.toDecimalString(),
    row.balanceAfter.toDecimalString(),
  ]);

const sum = (amounts: readonly Money[]): Money => Money.sum(amounts);

// 6,000 at 9 % over 6 months: i = 0.0075, A = 1,026.41. Each interest is the previous balance
// times i, half-up: 45.00, 37.639425 → 37.64, 30.22365 → 30.22, 22.752225 → 22.75,
// 15.224775 → 15.22, 7.64085 → 7.64. The last row repays the 1,018.78 left, one cent above A.
const SIX_MONTHS = amortizationSchedule({
  principal: eur('6000.00'),
  annualRate: Percentage.fromPercent(9),
  termMonths: 6,
  firstDueDate: day('2026-02-10'),
});

describe('amortizationSchedule', () => {
  it('should build the French table of a six month loan, row by row', () => {
    expect(asTable(SIX_MONTHS)).toEqual([
      ['1', '2026-02-10', '981.41', '45.00', '1026.41', '5018.59'],
      ['2', '2026-03-10', '988.77', '37.64', '1026.41', '4029.82'],
      ['3', '2026-04-10', '996.19', '30.22', '1026.41', '3033.63'],
      ['4', '2026-05-10', '1003.66', '22.75', '1026.41', '2029.97'],
      ['5', '2026-06-10', '1011.19', '15.22', '1026.41', '1018.78'],
      ['6', '2026-07-10', '1018.78', '7.64', '1026.42', '0.00'],
    ]);
  });

  // 10,000 at 7 % over 48 months: A = 239.46, the first month's interest 58.33 (58.333...).
  it('should repay exactly the principal over 48 months, the last instalment absorbing the rounding', () => {
    const rows = amortizationSchedule({
      principal: eur('10000.00'),
      annualRate: Percentage.fromPercent(7),
      termMonths: 48,
      firstDueDate: day('2026-11-05'),
    });

    expect(rows).toHaveLength(48);
    expect(asTable(rows.slice(0, 1))).toEqual([
      ['1', '2026-11-05', '181.13', '58.33', '239.46', '9818.87'],
    ]);
    expect(rows.slice(0, 47).every((row) => row.total.equals(eur('239.46')))).toBe(true);
    expect(rows.at(-1)?.dueDate.toString()).toBe('2030-10-05');
    expect(rows.at(-1)?.balanceAfter.isZero()).toBe(true);
    expect(sum(rows.map((row) => row.principal))).toEqual(eur('10000.00'));
    // The rounding of 48 rows stays within a few cents of the regular instalment.
    expect(Math.abs((rows.at(-1)?.total.cents ?? 0) - 239_46)).toBeLessThanOrEqual(24);
  });

  it('should split the principal evenly without interest at 0 %', () => {
    const rows = amortizationSchedule({
      principal: eur('1000.00'),
      annualRate: Percentage.zero(),
      termMonths: 6,
      firstDueDate: day('2026-02-10'),
    });

    expect(rows.map((row) => row.total.toDecimalString())).toEqual([
      '166.67',
      '166.67',
      '166.67',
      '166.67',
      '166.67',
      '166.65',
    ]);
    expect(rows.every((row) => row.interest.isZero())).toBe(true);
    expect(sum(rows.map((row) => row.principal))).toEqual(eur('1000.00'));
  });

  // Rounding accumulates over long terms and odd amounts; the principals must still add up to
  // the principal to the cent, and every balance go down.
  it.each([
    ['1234.57', 3.33, 6],
    ['9999.99', 24.99, 48],
    ['4321.09', 0.01, 36],
    ['12000.00', 12.5, 48],
    ['500.03', 0, 7],
  ])(
    'should keep the principals of %s at %d %% over %d months adding up exactly',
    (principal, percent, months) => {
      const rows = amortizationSchedule({
        principal: eur(principal),
        annualRate: Percentage.fromPercent(percent),
        termMonths: months,
        firstDueDate: day('2026-01-15'),
      });

      expect(sum(rows.map((row) => row.principal))).toEqual(eur(principal));
      expect(rows.at(-1)?.balanceAfter.isZero()).toBe(true);
      rows.forEach((row, index) => {
        expect(row.total).toEqual(row.principal.add(row.interest));
        expect(row.principal.isPositive()).toBe(true);
        const before = index === 0 ? eur(principal) : rows[index - 1]!.balanceAfter;
        expect(row.balanceAfter).toEqual(before.subtract(row.principal));
      });
    },
  );

  it('should refuse a principal too small to spread over the term', () => {
    expect(() =>
      amortizationSchedule({
        principal: Money.fromCents(130),
        annualRate: Percentage.zero(),
        termMonths: 48,
        firstDueDate: day('2026-01-15'),
      }),
    ).toThrow('too small');
  });
});

describe('firstDueDate', () => {
  it('should fall a month after activation, on the same day', () => {
    expect(firstDueDate(day('2026-10-12')).toString()).toBe('2026-11-12');
  });

  it('should move days a month may lack to the 28th', () => {
    expect(firstDueDate(day('2026-01-30')).toString()).toBe('2026-02-28');
    expect(firstDueDate(day('2026-03-31')).toString()).toBe('2026-04-28');
  });
});

describe('payoffQuote', () => {
  const quote = (asOf: string, paidInstallments: number[]) =>
    payoffQuote({
      schedule: SIX_MONTHS,
      principal: eur('6000.00'),
      annualRate: Percentage.fromPercent(9),
      startsOn: day('2026-01-10'),
      paidInstallments,
      asOf: day(asOf),
    });

  it('should be the principal alone on the day the plan starts', () => {
    expect(quote('2026-01-10', [])).toMatchObject({
      overdueInstallments: 0,
      outstandingPrincipal: eur('6000.00'),
      accruedInterest: eur('0.00'),
      total: eur('6000.00'),
    });
  });

  // 15 of the 31 days to the first due date: 6,000 × 0.0075 × 15 / 31 = 21.774... → 21.77.
  it('should add the interest accrued in the month so far', () => {
    expect(quote('2026-01-25', [])).toMatchObject({
      accruedInterest: eur('21.77'),
      total: eur('6021.77'),
    });
  });

  // 14 of the 28 days from 10 February: 5,018.59 × 0.0075 / 2 = 18.819... → 18.82.
  it('should start from the balance after the last instalment paid', () => {
    expect(quote('2026-02-24', [1])).toMatchObject({
      overdueInstallments: 0,
      outstandingPrincipal: eur('5018.59'),
      accruedInterest: eur('18.82'),
      total: eur('5037.41'),
    });
  });

  it('should include instalments already due and not paid', () => {
    expect(quote('2026-02-10', [])).toMatchObject({
      overdueInstallments: 1,
      overdueAmount: eur('1026.41'),
      outstandingPrincipal: eur('5018.59'),
      accruedInterest: eur('0.00'),
      total: eur('6045.00'),
    });
  });

  // A retried instalment collected after the next one: the first is still owed.
  it('should count as overdue an earlier instalment paid after a later one', () => {
    expect(quote('2026-03-10', [2])).toMatchObject({
      overdueInstallments: 1,
      overdueAmount: eur('1026.41'),
      outstandingPrincipal: eur('4029.82'),
    });
  });

  it('should owe only the last instalment once every due date has passed', () => {
    expect(quote('2026-08-01', [1, 2, 3, 4, 5])).toMatchObject({
      overdueInstallments: 1,
      outstandingPrincipal: eur('0.00'),
      accruedInterest: eur('0.00'),
      total: eur('1026.42'),
    });
    expect(quote('2026-08-01', [1, 2, 3, 4, 5, 6]).total).toEqual(eur('0.00'));
  });
});
