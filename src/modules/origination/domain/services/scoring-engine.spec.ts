import { Money, NationalId, Percentage, unwrap } from '@shared/domain';

import {
  aCompleteProfile,
  aProgramSnapshot,
  cleanBureau,
  INSTALLMENTS_24,
  NOW,
  passedKyc,
  steadyEmployment,
} from '../../../../../test/factories/origination';
import { type CompleteProfile } from '../model/applicant-profile';
import { type ProgramSnapshot, type RequestedProduct } from '../model/program-snapshot';
import { RiskPolicy } from '../model/risk-policy';
import { type BureauResult, type EmploymentResult, type KycResult } from '../model/verification';

import { estimatedMonthlyPayment, ScoringEngine, type ScoringInput } from './scoring-engine';

const POLICY = RiskPolicy.initial(NOW);

function scenario(
  overrides: {
    profile?: Partial<CompleteProfile>;
    program?: Partial<ProgramSnapshot>;
    product?: RequestedProduct;
    kyc?: Partial<KycResult>;
    employment?: Partial<EmploymentResult>;
    bureau?: Partial<BureauResult>;
  } = {},
): ScoringInput {
  return {
    profile: aCompleteProfile(overrides.profile),
    program: aProgramSnapshot(overrides.program),
    product: overrides.product ?? INSTALLMENTS_24,
    kyc: passedKyc(overrides.kyc),
    employment: steadyEmployment(overrides.employment),
    bureau: cleanBureau(overrides.bureau),
  };
}

const decide = (input: ScoringInput, policy = POLICY) => ScoringEngine.decide(input, policy, NOW);

// With no declared income affordability is 0, so the other three factors set the score exactly:
// 40·employability + 25·history + 15·bureau.
const withoutIncome = (employabilityPercent: number, monthsWorked: number, bureauScore: number) =>
  scenario({
    profile: { declaredMonthlyIncome: Money.zero() },
    program: { employabilityRate: Percentage.fromPercent(employabilityPercent) },
    employment: { monthsWorkedLast24: monthsWorked },
    bureau: { score: bureauScore },
  });

describe('ScoringEngine', () => {
  describe('estimated monthly payment', () => {
    it.each([
      [12, 65_068],
      [24, 33_750],
      [36, 23_330],
    ])('should use the annuity formula for instalments over %i months', (termMonths, cents) => {
      expect(
        estimatedMonthlyPayment(aProgramSnapshot(), { kind: 'installments', termMonths }).cents,
      ).toBe(cents);
    });

    it('should split the price evenly when the rate is 0 %', () => {
      const program = aProgramSnapshot({
        installments: { allowedTerms: [12], annualRate: Percentage.zero() },
      });

      expect(estimatedMonthlyPayment(program, { kind: 'installments', termMonths: 12 }).cents).toBe(
        62_500,
      );
    });

    it("should take the income share of the program's average salary for an ISA", () => {
      // 10 % of 28,000 EUR a year, monthly.
      expect(estimatedMonthlyPayment(aProgramSnapshot(), { kind: 'isa' }).cents).toBe(23_333);
    });
  });

  describe('score', () => {
    it('should weigh the four factors as the policy says and explain each one', () => {
      const decision = decide(scenario());

      expect(decision.factors).toEqual([
        { name: 'employability', weight: Percentage.fromPercent(40), value: 0.85, points: 34 },
        { name: 'employment_history', weight: Percentage.fromPercent(25), value: 1, points: 25 },
        // 1 − 337.50 / 1,800.00
        { name: 'affordability', weight: Percentage.fromPercent(20), value: 0.8125, points: 16.25 },
        { name: 'bureau', weight: Percentage.fromPercent(15), value: 0.8, points: 12 },
      ]);
      expect(decision.score).toBe(87.25);
      expect(decision.outcome).toBe('approved');
      expect(decision.estimatedMonthlyPayment.cents).toBe(33_750);
      expect(decision.policyVersion).toBe(1);
      expect(decision.decidedAt).toEqual(NOW);
      expect(decision.hardRulesBroken).toEqual([]);
      expect(decision.reasons[0]).toBe('Score 87.25 reaches the approval threshold of 70.');
    });

    it('should cap employment history at 24 months and count part of it', () => {
      expect(decide(scenario({ employment: { monthsWorkedLast24: 6 } })).factors[1]?.value).toBe(
        0.25,
      );
      expect(decide(scenario({ employment: { monthsWorkedLast24: 0 } })).factors[1]?.value).toBe(0);
    });

    it('should give no affordability when the payment reaches the income, or there is none', () => {
      const unaffordable = decide(
        scenario({ profile: { declaredMonthlyIncome: Money.fromCents(30_000) } }),
      );
      const noIncome = decide(scenario({ profile: { declaredMonthlyIncome: Money.zero() } }));

      expect(unaffordable.factors[2]?.value).toBe(0);
      expect(noIncome.factors[2]?.value).toBe(0);
      expect(unaffordable.reasons).toContain(
        'The estimated payment (337.50 EUR a month) is a large share of the declared income (300.00 EUR).',
      );
    });

    it('should judge an ISA by its payment at the average salary', () => {
      const decision = decide(scenario({ product: { kind: 'isa' } }));

      // 1 − 233.33 / 1,800.00 = 0.87037…
      expect(decision.factors[2]?.value).toBe(0.8704);
      expect(decision.estimatedMonthlyPayment.cents).toBe(23_333);
    });

    it('should keep the bureau factor between 0 and 1', () => {
      expect(decide(scenario({ bureau: { score: 1_200 } })).factors[3]?.value).toBe(1);
      expect(decide(scenario({ bureau: { score: -5 } })).factors[3]?.value).toBe(0);
    });

    it('should give the same decision for the same input', () => {
      const input = scenario({ employment: { monthsWorkedLast24: 7 }, bureau: { score: 613 } });

      expect(decide(input)).toEqual(decide(input));
    });
  });

  describe('thresholds', () => {
    it.each([
      // 30 + 25 + 15 = 70
      ['approve at exactly 70', withoutIncome(75, 24, 1_000), 70, 'approved'],
      // 30 + 25 + 14.99
      ['send 69.99 to review', withoutIncome(75, 24, 999), 69.99, 'needs_review'],
      // 30 + 12.5 + 7.5 = 50
      ['send exactly 50 to review', withoutIncome(75, 12, 500), 50, 'needs_review'],
      // 30 + 12.5 + 7.49 (7.485 rounded half up)
      ['reject 49.99', withoutIncome(75, 12, 499), 49.99, 'rejected'],
      ['reject a low score', withoutIncome(20, 0, 100), 9.5, 'rejected'],
    ] as const)('should %s', (_case, input, score, outcome) => {
      const decision = decide(input);

      expect(decision.score).toBe(score);
      expect(decision.outcome).toBe(outcome);
      expect(decision.hardRulesBroken).toEqual([]);
    });

    it('should explain a review and a rejection by score', () => {
      expect(decide(withoutIncome(75, 12, 500)).reasons[0]).toBe(
        'Score 50.00 is between the review (50) and approval (70) thresholds.',
      );
      expect(decide(withoutIncome(20, 0, 100)).reasons).toEqual([
        'Score 9.50 is below the review threshold of 50.',
        'Low program employability (20 %).',
        'Low employment history (0 %).',
        'The estimated payment (337.50 EUR a month) is a large share of the declared income (0.00 EUR).',
        'Low credit bureau score (10 %).',
      ]);
    });
  });

  describe('hard rules', () => {
    // NOW is 2026-10-09: born 2008-10-09 turns 18 that day.
    it.each([
      ['an applicant under 18', { profile: { dateOfBirth: '2008-10-10' } }, 'underage'],
      ['a resident of another country', { profile: { residenceCountry: 'PT' } }, 'residence'],
      [
        'an identity that could not be verified',
        { kyc: { verified: false } },
        'identity_not_verified',
      ],
      [
        'an applicant in a default registry',
        { bureau: { listedInDefaultRegistry: true } },
        'default_registry',
      ],
      [
        'an amount above the limit',
        { program: { price: Money.fromCents(12_000_01) } },
        'amount_above_limit',
      ],
    ] as const)('should reject %s whatever the score', (_case, overrides, rule) => {
      const decision = decide(scenario(overrides));

      expect(decision.outcome).toBe('rejected');
      expect(decision.hardRulesBroken).toEqual([rule]);
      expect(decision.score).toBeGreaterThan(POLICY.approveThreshold);
    });

    it('should accept the edges: 18 today and exactly the limit', () => {
      const decision = decide(
        scenario({
          profile: { dateOfBirth: '2008-10-09' },
          program: { price: Money.fromCents(12_000_00) },
        }),
      );

      expect(decision.hardRulesBroken).toEqual([]);
    });

    it('should list every broken rule with a readable reason', () => {
      const decision = decide(
        scenario({
          profile: {
            dateOfBirth: '2010-01-01',
            residenceCountry: 'FR',
            nationalId: unwrap(NationalId.create('X1234567L')),
          },
          kyc: { verified: false },
          bureau: { listedInDefaultRegistry: true },
          program: { price: Money.fromCents(15_000_00) },
        }),
      );

      expect(decision.hardRulesBroken).toEqual([
        'underage',
        'residence',
        'identity_not_verified',
        'default_registry',
        'amount_above_limit',
      ]);
      expect(decision.reasons).toEqual([
        'The applicant is 16; the minimum age is 18.',
        'Tramo finances residents of ES only.',
        'The identity could not be verified.',
        'The applicant is listed in a default registry.',
        'The amount (15000.00 EUR) is above the limit of 12000.00 EUR.',
      ]);
    });
  });

  describe('policies', () => {
    it('should apply the weights, thresholds and limits of the policy it is given', () => {
      const strict = POLICY.revise(
        {
          weights: {
            employability: Percentage.fromPercent(10),
            employment_history: Percentage.fromPercent(10),
            affordability: Percentage.fromPercent(10),
            bureau: Percentage.fromPercent(70),
          },
          approveThreshold: 90,
          reviewThreshold: 80,
          maxFinanceable: Money.fromCents(5_000_00),
          allowedResidenceCountries: ['ES', 'PT'],
        },
        'admin-1',
        NOW,
      );
      const input = scenario({ profile: { residenceCountry: 'PT' } });

      const decision = decide(input, strict);

      // 8.5 + 10 + 8.13 + 56
      expect(decision.score).toBe(82.63);
      expect(decision.policyVersion).toBe(2);
      expect(decision.hardRulesBroken).toEqual(['amount_above_limit']);
      expect(
        decide(
          { ...input, program: aProgramSnapshot({ price: Money.fromCents(4_000_00) }) },
          strict,
        ).outcome,
      ).toBe('needs_review');
    });
  });
});
