import { InvalidValueError } from './domain-error';
import { Percentage } from './percentage';

describe('Percentage', () => {
  it('should build the same value from percent, fraction and basis points', () => {
    const fromPercent = Percentage.fromPercent(7.5);

    expect(fromPercent.basisPoints).toBe(750);
    expect(fromPercent.equals(Percentage.fromFraction('0.075'))).toBe(true);
    expect(fromPercent.equals(Percentage.fromBasisPoints(750))).toBe(true);
  });

  it('should expose the rate as an exact decimal', () => {
    expect(Percentage.fromPercent(8.25).asDecimal().toString()).toBe('0.0825');
    expect(Percentage.fromPercent(8.25).toFraction()).toBe(0.0825);
    expect(Percentage.fromPercent(8.25).toPercent()).toBe(8.25);
  });

  it('should reject values outside 0..100 %', () => {
    expect(() => Percentage.fromPercent(-1)).toThrow(InvalidValueError);
    expect(() => Percentage.fromPercent(100.01)).toThrow(InvalidValueError);
  });

  it('should reject more precision than a basis point', () => {
    expect(() => Percentage.fromPercent('7.555')).toThrow(InvalidValueError);
    expect(() => Percentage.fromBasisPoints(1.5)).toThrow(InvalidValueError);
  });

  it('should compare and format', () => {
    expect(Percentage.fromFraction(0.6).gte(Percentage.fromFraction(0.6))).toBe(true);
    expect(Percentage.zero().isZero()).toBe(true);
    expect(Percentage.fromPercent(12.5).toString()).toBe('12.5 %');
  });
});
