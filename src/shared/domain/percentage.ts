import { Decimal } from 'decimal.js';

import { InvalidValueError } from './domain-error';
import { ValueObject } from './value-object';

const BPS_PER_UNIT = 10_000;

// Stored as integer basis points (1 bp = 0.01 %): interest rates, income share and fees are
// represented exactly and map to an integer column.
export class Percentage extends ValueObject<{ basisPoints: number }> {
  private constructor(basisPoints: number) {
    super({ basisPoints });
  }

  static fromBasisPoints(basisPoints: number): Percentage {
    if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > BPS_PER_UNIT) {
      throw new InvalidValueError(
        'percentage',
        `Percentage must be between 0 and 10000 basis points, got ${basisPoints}.`,
      );
    }
    return new Percentage(basisPoints);
  }

  // fromPercent(7.5) is 7.5 %
  static fromPercent(percent: Decimal.Value): Percentage {
    return Percentage.fromBasisPoints(wholeBasisPoints(new Decimal(percent).times(100)));
  }

  // fromFraction(0.075) is 7.5 %
  static fromFraction(fraction: Decimal.Value): Percentage {
    return Percentage.fromBasisPoints(wholeBasisPoints(new Decimal(fraction).times(BPS_PER_UNIT)));
  }

  static zero(): Percentage {
    return new Percentage(0);
  }

  get basisPoints(): number {
    return this.props.basisPoints;
  }

  asDecimal(): Decimal {
    return new Decimal(this.basisPoints).dividedBy(BPS_PER_UNIT);
  }

  toFraction(): number {
    return this.asDecimal().toNumber();
  }

  toPercent(): number {
    return this.basisPoints / 100;
  }

  isZero(): boolean {
    return this.basisPoints === 0;
  }

  gte(other: Percentage): boolean {
    return this.basisPoints >= other.basisPoints;
  }

  override toString(): string {
    return `${this.toPercent().toString()} %`;
  }
}

function wholeBasisPoints(value: Decimal): number {
  if (!value.isInteger()) {
    throw new InvalidValueError('percentage', 'Percentages are limited to two decimals.');
  }
  return value.toNumber();
}
