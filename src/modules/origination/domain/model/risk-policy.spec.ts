import { Money, Percentage } from '@shared/domain';

import { NOW } from '../../../../../test/factories/origination';
import { InvalidRiskPolicyError } from '../errors/origination-errors';

import { RiskPolicy } from './risk-policy';

const initial = RiskPolicy.initial(NOW);

describe('RiskPolicy', () => {
  it('should start at version 1 with the rules Tramo launched with', () => {
    expect(initial.version).toBe(1);
    expect(initial.maxFinanceable.cents).toBe(12_000_00);
    expect(initial.minAgeYears).toBe(18);
    expect(initial.allowedResidenceCountries).toEqual(['ES']);
    expect(initial.weights.employability.basisPoints).toBe(4_000);
    expect([initial.approveThreshold, initial.reviewThreshold]).toEqual([70, 50]);
  });

  it('should revise into the next version, leaving the old one as it was', () => {
    const next = initial.revise(
      { approveThreshold: 75, allowedResidenceCountries: ['PT', 'ES', 'ES'] },
      'admin-1',
      NOW,
    );

    expect(next.version).toBe(2);
    expect(next.approveThreshold).toBe(75);
    expect(next.allowedResidenceCountries).toEqual(['ES', 'PT']);
    expect(next.createdBy).toBe('admin-1');
    expect(initial.approveThreshold).toBe(70);
  });

  it.each([
    [
      'weights that do not add up to 100 %',
      { weights: { ...initial.weights, bureau: Percentage.fromPercent(20) } },
    ],
    ['a review threshold at the approval one', { reviewThreshold: 70 }],
    ['an approval threshold above 100', { approveThreshold: 101 }],
    ['a fractional threshold', { reviewThreshold: 49.5 }],
    ['a minimum age under 18', { minAgeYears: 16 }],
    ['no countries', { allowedResidenceCountries: [] }],
    ['a country that is not a code', { allowedResidenceCountries: ['Spain'] }],
    ['a zero limit', { maxFinanceable: Money.zero() }],
  ])('should refuse %s', (_case, changes) => {
    expect(() => initial.revise(changes, 'admin-1', NOW)).toThrow(InvalidRiskPolicyError);
  });

  it('should refuse a version that is not a positive whole number', () => {
    expect(() =>
      RiskPolicy.define(0, {
        maxFinanceable: initial.maxFinanceable,
        minAgeYears: 18,
        allowedResidenceCountries: ['ES'],
        weights: initial.weights,
        approveThreshold: 70,
        reviewThreshold: 50,
        createdAt: NOW,
        createdBy: 'admin-1',
      }),
    ).toThrow(InvalidRiskPolicyError);
  });
});
