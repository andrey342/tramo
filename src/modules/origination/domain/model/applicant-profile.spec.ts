import { aCompleteProfile } from '../../../../../test/factories/origination';

import { ageInYears, EMPTY_PROFILE, missingFields } from './applicant-profile';

describe('applicant profile', () => {
  it.each([
    ['2008-10-11', '2026-10-10T23:59:59Z', 17],
    ['2008-10-11', '2026-10-11T00:00:00Z', 18],
    ['2008-02-29', '2026-02-28T12:00:00Z', 17],
    ['2008-02-29', '2026-03-01T00:00:00Z', 18],
    ['1990-12-31', '2026-01-01T00:00:00Z', 35],
  ])('should count someone born on %s, on %s, as %i years old', (born, on, age) => {
    expect(ageInYears(born, new Date(on))).toBe(age);
  });

  it('should list the fields still empty, in a stable order', () => {
    expect(missingFields(EMPTY_PROFILE)).toEqual([
      'dateOfBirth',
      'nationalId',
      'residenceCountry',
      'declaredMonthlyIncome',
      'employmentStatus',
    ]);
    expect(missingFields(aCompleteProfile())).toEqual([]);
  });
});
