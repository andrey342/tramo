import { InvalidValueError } from './domain-error';
import { Money } from './money';
import { Percentage } from './percentage';

describe('Money', () => {
  it('should parse decimal amounts into exact cents', () => {
    expect(Money.fromDecimal('7500.00').cents).toBe(750_000);
    expect(Money.fromDecimal(0.1).add(Money.fromDecimal(0.2)).cents).toBe(30);
  });

  it('should reject amounts with fractions of a cent', () => {
    expect(() => Money.fromDecimal('10.005')).toThrow(InvalidValueError);
    expect(() => Money.fromCents(10.5)).toThrow(InvalidValueError);
  });

  it('should add and subtract without floating point drift', () => {
    const total = Money.sum([0.1, 0.2, 0.3].map((amount) => Money.fromDecimal(amount)));

    expect(total.toDecimalString()).toBe('0.60');
    expect(total.subtract(Money.fromDecimal('0.60')).isZero()).toBe(true);
  });

  it('should round half up to the cent when multiplied by a rate', () => {
    expect(Money.fromCents(5).multiply('0.5').cents).toBe(3);
    expect(Money.fromCents(-5).multiply('0.5').cents).toBe(-3);
    expect(Money.fromCents(5).multiply('0.5', 'down').cents).toBe(2);
  });

  it('should apply a percentage', () => {
    const fee = Money.fromDecimal('7500.00').percentage(Percentage.fromPercent(7.5));

    expect(fee.toDecimalString()).toBe('562.50');
  });

  it('should allocate a remainder cent by cent so the parts add up exactly', () => {
    const parts = Money.fromCents(1000).allocate(3);

    expect(parts.map((part) => part.cents)).toEqual([334, 333, 333]);
    expect(Money.sum(parts).cents).toBe(1000);
  });

  it('should allocate negative amounts symmetrically', () => {
    expect(
      Money.fromCents(-1000)
        .allocate(3)
        .map((part) => part.cents),
    ).toEqual([-334, -333, -333]);
  });

  it('should refuse to allocate into zero parts', () => {
    expect(() => Money.fromCents(100).allocate(0)).toThrow(InvalidValueError);
  });

  it('should compare amounts', () => {
    const small = Money.fromCents(100);
    const large = Money.fromCents(200);

    expect(small.lt(large)).toBe(true);
    expect(large.gte(large)).toBe(true);
    expect(Money.min(small, large)).toBe(small);
    expect(Money.max(small, large)).toBe(large);
    expect(small.compare(large)).toBe(-1);
  });

  it('should treat a rounded negative zero as zero', () => {
    const rounded = Money.fromCents(-5).multiply('0.05');

    expect(Object.is(rounded.cents, -0)).toBe(false);
    expect(rounded.equals(Money.zero())).toBe(true);
  });

  it('should be equal by value', () => {
    expect(Money.fromCents(100).equals(Money.fromDecimal('1.00'))).toBe(true);
    expect(Money.fromCents(100).equals(Money.fromCents(101))).toBe(false);
  });

  it('should format with two decimals and the currency', () => {
    expect(Money.fromCents(-5).toString()).toBe('-0.05 EUR');
  });
});
