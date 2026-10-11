import { Money, Percentage } from '@shared/domain';

import { InvalidRiskPolicyError } from '../errors/origination-errors';

import { type ScoreFactorName, SCORE_FACTORS } from './decision-record';

export type ScoreWeights = { readonly [K in ScoreFactorName]: Percentage };

export interface RiskPolicyProps {
  readonly maxFinanceable: Money;
  readonly minAgeYears: number;
  readonly allowedResidenceCountries: readonly string[];
  // Add up to 100 %.
  readonly weights: ScoreWeights;
  // Scores at or above approve; at or above review (and below approve) go to an analyst.
  readonly approveThreshold: number;
  readonly reviewThreshold: number;
  readonly createdAt: Date;
  readonly createdBy: string;
}

// The rules and thresholds the scoring engine applies. Versions are immutable: a new policy is
// a new version, the highest one is in force, and every decision records the version it used, so
// a decision can always be explained with the rules of its day.
export class RiskPolicy {
  private constructor(
    readonly version: number,
    private readonly props: RiskPolicyProps,
  ) {}

  static define(version: number, props: RiskPolicyProps): RiskPolicy {
    if (!Number.isInteger(version) || version < 1) {
      throw new InvalidRiskPolicyError('the version must be a positive whole number');
    }
    if (!props.maxFinanceable.isPositive()) {
      throw new InvalidRiskPolicyError('the maximum financeable amount must be positive');
    }
    if (!Number.isInteger(props.minAgeYears) || props.minAgeYears < 18 || props.minAgeYears > 99) {
      throw new InvalidRiskPolicyError('the minimum age must be 18 to 99');
    }
    if (
      props.allowedResidenceCountries.length === 0 ||
      props.allowedResidenceCountries.some((country) => !/^[A-Z]{2}$/.test(country))
    ) {
      throw new InvalidRiskPolicyError('residence countries must be ISO 3166-1 alpha-2 codes');
    }
    const totalBps = SCORE_FACTORS.reduce(
      (sum, factor) => sum + props.weights[factor].basisPoints,
      0,
    );
    if (totalBps !== 10_000) {
      throw new InvalidRiskPolicyError('the factor weights must add up to 100 %');
    }
    const { approveThreshold: approve, reviewThreshold: review } = props;
    if (
      !Number.isInteger(approve) ||
      !Number.isInteger(review) ||
      review < 0 ||
      approve > 100 ||
      review >= approve
    ) {
      throw new InvalidRiskPolicyError(
        'thresholds must be whole scores with review below approval, within 0 to 100',
      );
    }
    return new RiskPolicy(version, {
      ...props,
      allowedResidenceCountries: [...new Set(props.allowedResidenceCountries)].sort(),
    });
  }

  // Loading a stored version: it was valid when defined, and stays as it was.
  static reconstitute(version: number, props: RiskPolicyProps): RiskPolicy {
    return new RiskPolicy(version, props);
  }

  // The first policy, seeded by the migration that creates the table.
  static initial(createdAt: Date): RiskPolicy {
    return RiskPolicy.define(1, {
      maxFinanceable: Money.fromCents(12_000_00),
      minAgeYears: 18,
      allowedResidenceCountries: ['ES'],
      weights: {
        employability: Percentage.fromPercent(40),
        employment_history: Percentage.fromPercent(25),
        affordability: Percentage.fromPercent(20),
        bureau: Percentage.fromPercent(15),
      },
      approveThreshold: 70,
      reviewThreshold: 50,
      createdAt,
      createdBy: 'system',
    });
  }

  get maxFinanceable(): Money {
    return this.props.maxFinanceable;
  }

  get minAgeYears(): number {
    return this.props.minAgeYears;
  }

  get allowedResidenceCountries(): readonly string[] {
    return this.props.allowedResidenceCountries;
  }

  get weights(): ScoreWeights {
    return this.props.weights;
  }

  get approveThreshold(): number {
    return this.props.approveThreshold;
  }

  get reviewThreshold(): number {
    return this.props.reviewThreshold;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get createdBy(): string {
    return this.props.createdBy;
  }

  // The next version, with these changes on top of this one.
  revise(
    changes: Partial<Omit<RiskPolicyProps, 'createdAt' | 'createdBy'>>,
    by: string,
    now: Date,
  ): RiskPolicy {
    return RiskPolicy.define(this.version + 1, {
      ...this.props,
      ...changes,
      createdAt: now,
      createdBy: by,
    });
  }
}
