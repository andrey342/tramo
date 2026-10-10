import { type Money, type Percentage } from '@shared/domain';

export type DecisionOutcome = 'approved' | 'needs_review' | 'rejected';

export const SCORE_FACTORS = [
  'employability',
  'employment_history',
  'affordability',
  'bureau',
] as const;
export type ScoreFactorName = (typeof SCORE_FACTORS)[number];

export interface ScoreFactor {
  readonly name: ScoreFactorName;
  readonly weight: Percentage;
  // How the applicant does on this factor, 0 to 1 (four decimals).
  readonly value: number;
  // weight × value × 100: what the factor adds to the score (two decimals).
  readonly points: number;
}

export const HARD_RULES = [
  'underage',
  'residence',
  'identity_not_verified',
  'default_registry',
  'amount_above_limit',
] as const;
export type HardRule = (typeof HARD_RULES)[number];

// Why the engine decided what it did, kept with the application: the score, each factor with
// its weight and value, the hard rules broken, readable reasons and the policy version used.
export interface DecisionRecord {
  readonly outcome: DecisionOutcome;
  // 0 to 100, two decimals.
  readonly score: number;
  readonly factors: readonly ScoreFactor[];
  readonly hardRulesBroken: readonly HardRule[];
  readonly reasons: readonly string[];
  readonly estimatedMonthlyPayment: Money;
  readonly policyVersion: number;
  readonly decidedAt: Date;
}

// An ops analyst's call on an application the engine sent to review.
export interface ManualDecision {
  readonly outcome: 'approved' | 'rejected';
  readonly reason: string;
  readonly decidedBy: string;
  readonly decidedAt: Date;
}
