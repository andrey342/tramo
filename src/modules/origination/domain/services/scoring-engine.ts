import { Decimal } from 'decimal.js';

import { Money } from '@shared/domain';

import { ageInYears, type CompleteProfile } from '../model/applicant-profile';
import {
  type DecisionOutcome,
  type DecisionRecord,
  type HardRule,
  type ScoreFactor,
  type ScoreFactorName,
} from '../model/decision-record';
import { type ProgramSnapshot, type RequestedProduct } from '../model/program-snapshot';
import { type RiskPolicy } from '../model/risk-policy';
import { type BureauResult, type EmploymentResult, type KycResult } from '../model/verification';

export interface ScoringInput {
  readonly profile: CompleteProfile;
  readonly program: ProgramSnapshot;
  readonly product: RequestedProduct;
  readonly kyc: KycResult;
  readonly employment: EmploymentResult;
  readonly bureau: BureauResult;
}

const BUREAU_MAX = 1_000;
const HISTORY_MONTHS = 24;

// Pure function of the application, its verifications and the policy: no IO, no clock (the
// decision time is passed in), so the same input always gives the same decision.
//
// 1. Hard rules: any broken rule rejects, whatever the score.
// 2. Score 0-100: the weighted sum of four factors, each 0 to 1 —
//    employability of the program, employment history (months worked of the last 24),
//    affordability (1 − estimated payment / declared income, floored at 0) and the bureau score.
// 3. Thresholds of the policy: approve, send to review, or reject.
export const ScoringEngine = {
  decide(input: ScoringInput, policy: RiskPolicy, now: Date): DecisionRecord {
    const payment = estimatedMonthlyPayment(input.program, input.product);
    const hardRulesBroken = brokenHardRules(input, policy, now);

    const values: Record<ScoreFactorName, Decimal> = {
      employability: input.program.employabilityRate.asDecimal(),
      employment_history: Decimal.min(
        new Decimal(input.employment.monthsWorkedLast24).dividedBy(HISTORY_MONTHS),
        1,
      ),
      affordability: affordability(payment, input.profile.declaredMonthlyIncome),
      bureau: Decimal.min(Decimal.max(new Decimal(input.bureau.score).dividedBy(BUREAU_MAX), 0), 1),
    };
    const factors: ScoreFactor[] = (Object.keys(values) as ScoreFactorName[]).map((name) => {
      const value = values[name].toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
      return {
        name,
        weight: policy.weights[name],
        value: value.toNumber(),
        points: policy.weights[name]
          .asDecimal()
          .times(value)
          .times(100)
          .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
          .toNumber(),
      };
    });
    const score = factors
      .reduce((sum, factor) => sum.plus(factor.points), new Decimal(0))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
      .toNumber();

    const outcome: DecisionOutcome =
      hardRulesBroken.length > 0
        ? 'rejected'
        : score >= policy.approveThreshold
          ? 'approved'
          : score >= policy.reviewThreshold
            ? 'needs_review'
            : 'rejected';

    return {
      outcome,
      score,
      factors,
      hardRulesBroken: hardRulesBroken.map((broken) => broken.rule),
      reasons: reasons(outcome, score, policy, hardRulesBroken, factors, payment, input),
      estimatedMonthlyPayment: payment,
      policyVersion: policy.version,
      decidedAt: now,
    };
  },
};

// Instalments: the annuity payment of the price over the term at the program's rate
// (price / term when the rate is 0). ISA: the income share of the program's average salary,
// which is what a typical graduate would pay.
export function estimatedMonthlyPayment(
  program: ProgramSnapshot,
  product: RequestedProduct,
): Money {
  if (product.kind === 'isa') {
    const share = program.isa?.incomeShare;
    return share
      ? program.avgStartingSalary.multiply(share.asDecimal().dividedBy(12))
      : Money.zero();
  }
  const principal = new Decimal(program.price.cents);
  const monthlyRate = (program.installments?.annualRate.asDecimal() ?? new Decimal(0)).dividedBy(
    12,
  );
  const term = product.termMonths;
  const cents = monthlyRate.isZero()
    ? principal.dividedBy(term)
    : principal.times(monthlyRate).dividedBy(new Decimal(1).minus(monthlyRate.plus(1).pow(-term)));
  return Money.fromCents(cents.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber());
}

function affordability(payment: Money, income: Money): Decimal {
  if (!income.isPositive()) {
    return new Decimal(0);
  }
  const share = Decimal.min(new Decimal(payment.cents).dividedBy(income.cents), 1);
  return new Decimal(1).minus(share);
}

interface BrokenRule {
  readonly rule: HardRule;
  readonly reason: string;
}

function brokenHardRules(input: ScoringInput, policy: RiskPolicy, now: Date): BrokenRule[] {
  const broken: BrokenRule[] = [];
  const age = ageInYears(input.profile.dateOfBirth, now);
  if (age < policy.minAgeYears) {
    broken.push({
      rule: 'underage',
      reason: `The applicant is ${String(age)}; the minimum age is ${String(policy.minAgeYears)}.`,
    });
  }
  if (!policy.allowedResidenceCountries.includes(input.profile.residenceCountry)) {
    broken.push({
      rule: 'residence',
      reason: `Tramo finances residents of ${policy.allowedResidenceCountries.join(', ')} only.`,
    });
  }
  if (!input.kyc.verified) {
    broken.push({ rule: 'identity_not_verified', reason: 'The identity could not be verified.' });
  }
  if (input.bureau.listedInDefaultRegistry) {
    broken.push({
      rule: 'default_registry',
      reason: 'The applicant is listed in a default registry.',
    });
  }
  if (input.program.price.gt(policy.maxFinanceable)) {
    broken.push({
      rule: 'amount_above_limit',
      reason: `The amount (${input.program.price.toString()}) is above the limit of ${policy.maxFinanceable.toString()}.`,
    });
  }
  return broken;
}

const FACTOR_LABELS: Readonly<Record<ScoreFactorName, string>> = {
  employability: 'program employability',
  employment_history: 'employment history',
  affordability: 'affordability',
  bureau: 'credit bureau score',
};

function reasons(
  outcome: DecisionOutcome,
  score: number,
  policy: RiskPolicy,
  broken: readonly BrokenRule[],
  factors: readonly ScoreFactor[],
  payment: Money,
  input: ScoringInput,
): string[] {
  if (broken.length > 0) {
    return broken.map((rule) => rule.reason);
  }
  const verdict =
    outcome === 'approved'
      ? `Score ${score.toFixed(2)} reaches the approval threshold of ${String(policy.approveThreshold)}.`
      : outcome === 'needs_review'
        ? `Score ${score.toFixed(2)} is between the review (${String(policy.reviewThreshold)}) and approval (${String(policy.approveThreshold)}) thresholds.`
        : `Score ${score.toFixed(2)} is below the review threshold of ${String(policy.reviewThreshold)}.`;
  const weak = factors
    .filter((factor) => factor.value < 0.5)
    .map((factor) =>
      factor.name === 'affordability'
        ? `The estimated payment (${payment.toString()} a month) is a large share of the declared income (${input.profile.declaredMonthlyIncome.toString()}).`
        : `Low ${FACTOR_LABELS[factor.name]} (${String(Math.round(factor.value * 100))} %).`,
    );
  return [verdict, ...weak];
}
