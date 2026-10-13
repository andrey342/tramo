import { Decimal } from 'decimal.js';

import { InvalidValueError, Money, Percentage } from '@shared/domain';

// The figures dashboards show, from counts and sums of the read models.

// `part` of `whole` as a percentage, half up to the basis point; none while there is no whole
// (no decided application, no contract being repaid).
export function shareOf(part: number, whole: number): Percentage | null {
  if (!Number.isInteger(part) || !Number.isInteger(whole) || part < 0 || part > whole) {
    throw new InvalidValueError(
      'share',
      `Expected 0 <= part <= whole, got ${String(part)} of ${String(whole)}.`,
    );
  }
  if (whole === 0) {
    return null;
  }
  return Percentage.fromBasisPoints(
    new Decimal(part)
      .times(10_000)
      .dividedBy(whole)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber(),
  );
}

// The mean of `count` amounts adding up to `totalCents`, half up to the cent; none for no amount.
export function averageOf(totalCents: number, count: number): Money | null {
  if (count === 0) {
    return null;
  }
  return Money.fromCents(
    new Decimal(totalCents).dividedBy(count).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
}
