import { Decimal } from 'decimal.js';

import { InvalidValueError } from './domain-error';
import { Money } from './money';
import { Percentage } from './percentage';

// Arithmetic of a loan repaid in equal monthly instalments (French amortisation), shared by
// origination's offer and lending's plan, so the instalment offered is the instalment charged.

// i = TIN / 12
export function monthlyRate(annualRate: Percentage): Decimal {
  return annualRate.asDecimal().dividedBy(12);
}

// A = P·i / (1 − (1 + i)^−n), or P / n without interest; half-up to the cent.
export function annuityPayment(principal: Money, annualRate: Percentage, months: number): Money {
  if (!Number.isInteger(months) || months <= 0) {
    throw new InvalidValueError(
      'months',
      `A loan runs over a whole number of months, got ${months}.`,
    );
  }
  const rate = monthlyRate(annualRate);
  const cents = new Decimal(principal.cents);
  const payment = rate.isZero()
    ? cents.dividedBy(months)
    : cents.times(rate).dividedBy(new Decimal(1).minus(rate.plus(1).pow(-months)));
  return Money.fromCents(
    payment.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
    principal.currency,
  );
}

// TAE = (1 + i)^12 − 1, to the basis point (two decimals of a percent, as it is published). It
// includes no fees: the student pays none, the platform fee is the training center's.
export function annualPercentageRate(annualRate: Percentage): Percentage {
  const effective = monthlyRate(annualRate).plus(1).pow(12).minus(1);
  return Percentage.fromBasisPoints(
    effective.times(10_000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber(),
  );
}
