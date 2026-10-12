import { annualPercentageRate, annuityPayment } from './annuity';
import { Money } from './money';
import { Percentage } from './percentage';

const eur = (amount: string): Money => Money.fromDecimal(amount);
const rate = (percent: number): Percentage => Percentage.fromPercent(percent);

describe('annuity', () => {
  // Reference values from any loan table: 10,000 at 12 % over 12 months pays 888.49 a month,
  // at 7 % over 48 months 239.46.
  it.each([
    ['10000.00', 12, 12, '888.49'],
    ['10000.00', 7, 48, '239.46'],
    ['6000.00', 9, 6, '1026.41'],
    ['1000.00', 0, 6, '166.67'],
    ['7500.00', 0, 48, '156.25'],
  ])(
    'should pay %s at %d %% over %d months in instalments of %s',
    (principal, percent, months, payment) => {
      expect(annuityPayment(eur(principal), rate(percent), months)).toEqual(eur(payment));
    },
  );

  it('should refuse a term that is not a whole positive number of months', () => {
    expect(() => annuityPayment(eur('1000.00'), rate(5), 0)).toThrow('whole number of months');
    expect(() => annuityPayment(eur('1000.00'), rate(5), 6.5)).toThrow('whole number of months');
  });

  // TAE of a monthly compounded TIN: 12 % gives 12.68 %, 7 % gives 7.23 %, 0 % gives 0 %.
  it.each([
    [12, 1_268],
    [7, 723],
    [9, 938],
    [25, 2_807],
    [0, 0],
  ])('should give a TAE for a TIN of %d %% of %d basis points', (percent, basisPoints) => {
    expect(annualPercentageRate(rate(percent)).basisPoints).toBe(basisPoints);
  });
});
