import { Decimal } from 'decimal.js';

import { InvalidValueError } from './domain-error';
import { type Percentage } from './percentage';
import { ValueObject } from './value-object';

// Single currency today (Spain and Germany). Widening this union is the point where operations
// between amounts need a runtime currency check.
export type Currency = 'EUR';

export type Rounding = 'half-up' | 'down' | 'up';

const DECIMAL_ROUNDING: Record<Rounding, Decimal.Rounding> = {
  'half-up': Decimal.ROUND_HALF_UP,
  down: Decimal.ROUND_DOWN,
  up: Decimal.ROUND_UP,
};

// Amounts are integer cents (ADR 005). Arithmetic between amounts stays in integers; only
// multiplication by a rate goes through decimal.js, and the caller decides how to round back.
// Default rounding is half-up to the cent, the usual commercial rule for consumer credit in Spain.
export class Money extends ValueObject<{ cents: number; currency: Currency }> {
  private constructor(cents: number, currency: Currency) {
    // Rounding a small negative amount can yield -0, which Object.is (used by equals) tells apart
    // from 0.
    super({ cents: cents === 0 ? 0 : cents, currency });
  }

  static fromCents(cents: number, currency: Currency = 'EUR'): Money {
    if (!Number.isSafeInteger(cents)) {
      throw new InvalidValueError(
        'amount',
        `Amount must be a whole number of cents, got ${cents}.`,
      );
    }
    return new Money(cents, currency);
  }

  static fromDecimal(amount: string | number, currency: Currency = 'EUR'): Money {
    const value = new Decimal(amount);
    if (value.decimalPlaces() > 2) {
      throw new InvalidValueError('amount', `Amount ${String(amount)} has more than two decimals.`);
    }
    return Money.fromCents(value.times(100).toNumber(), currency);
  }

  static zero(currency: Currency = 'EUR'): Money {
    return new Money(0, currency);
  }

  static sum(amounts: readonly Money[], currency: Currency = 'EUR'): Money {
    return amounts.reduce((total, amount) => total.add(amount), Money.zero(currency));
  }

  static min(a: Money, b: Money): Money {
    return a.lte(b) ? a : b;
  }

  static max(a: Money, b: Money): Money {
    return a.gte(b) ? a : b;
  }

  get cents(): number {
    return this.props.cents;
  }

  get currency(): Currency {
    return this.props.currency;
  }

  add(other: Money): Money {
    return Money.fromCents(this.cents + other.cents, this.currency);
  }

  subtract(other: Money): Money {
    return Money.fromCents(this.cents - other.cents, this.currency);
  }

  multiply(factor: Decimal.Value, rounding: Rounding = 'half-up'): Money {
    const cents = new Decimal(this.cents)
      .times(factor)
      .toDecimalPlaces(0, DECIMAL_ROUNDING[rounding]);
    return Money.fromCents(cents.toNumber(), this.currency);
  }

  percentage(rate: Percentage, rounding: Rounding = 'half-up'): Money {
    return this.multiply(rate.asDecimal(), rounding);
  }

  // Splits into `parts` amounts that add up exactly to this one; the first parts absorb the
  // remainder one cent each.
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new InvalidValueError('parts', `Cannot allocate into ${parts} parts.`);
    }
    const base = Math.trunc(this.cents / parts);
    const remainder = this.cents - base * parts;
    const step = Math.sign(remainder);
    return Array.from({ length: parts }, (_, index) =>
      Money.fromCents(base + (index < Math.abs(remainder) ? step : 0), this.currency),
    );
  }

  isZero(): boolean {
    return this.cents === 0;
  }

  isPositive(): boolean {
    return this.cents > 0;
  }

  isNegative(): boolean {
    return this.cents < 0;
  }

  compare(other: Money): -1 | 0 | 1 {
    if (this.cents === other.cents) {
      return 0;
    }
    return this.cents < other.cents ? -1 : 1;
  }

  gt(other: Money): boolean {
    return this.compare(other) > 0;
  }

  gte(other: Money): boolean {
    return this.compare(other) >= 0;
  }

  lt(other: Money): boolean {
    return this.compare(other) < 0;
  }

  lte(other: Money): boolean {
    return this.compare(other) <= 0;
  }

  toDecimalString(): string {
    return new Decimal(this.cents).dividedBy(100).toFixed(2);
  }

  override toString(): string {
    return `${this.toDecimalString()} ${this.currency}`;
  }
}
