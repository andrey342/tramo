import { InvalidValueError, Money } from '@shared/domain';

import { averageOf, shareOf } from './portfolio-figures';

describe('portfolio figures', () => {
  // 1 of 3 is 33.333...%: 3333 bp; 2 of 3 rounds up to 6667 bp.
  it('should give a share in basis points, half up, and none without a whole', () => {
    expect(shareOf(1, 3)?.basisPoints).toBe(3_333);
    expect(shareOf(2, 3)?.basisPoints).toBe(6_667);
    expect(shareOf(3, 3)?.basisPoints).toBe(10_000);
    expect(shareOf(0, 0)).toBeNull();
    expect(() => shareOf(4, 3)).toThrow(InvalidValueError);
    expect(() => shareOf(0.5, 3)).toThrow(InvalidValueError);
  });

  it('should give the mean amount, half up to the cent, and none for no amount', () => {
    expect(averageOf(1_000_01, 2)).toEqual(Money.fromCents(500_01));
    expect(averageOf(7_500_00, 1)).toEqual(Money.fromCents(7_500_00));
    expect(averageOf(0, 0)).toBeNull();
  });
});
