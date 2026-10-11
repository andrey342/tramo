import { InvalidValueError, type Money, type NationalId } from '@shared/domain';

export const EMPLOYMENT_STATUSES = ['employed', 'self_employed', 'unemployed', 'student'] as const;
export type EmploymentStatus = (typeof EMPLOYMENT_STATUSES)[number];

// What the student declares about themselves. A draft may leave any of it empty; submitting
// needs all of it.
export interface ApplicantProfile {
  // Calendar date, YYYY-MM-DD.
  readonly dateOfBirth: string | null;
  readonly nationalId: NationalId | null;
  // ISO 3166-1 alpha-2.
  readonly residenceCountry: string | null;
  readonly declaredMonthlyIncome: Money | null;
  readonly employmentStatus: EmploymentStatus | null;
}

export const EMPTY_PROFILE: ApplicantProfile = {
  dateOfBirth: null,
  nationalId: null,
  residenceCountry: null,
  declaredMonthlyIncome: null,
  employmentStatus: null,
};

export type CompleteProfile = {
  readonly [K in keyof ApplicantProfile]: NonNullable<ApplicantProfile[K]>;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
// Monthly income above this is a typo, not a student.
const MAX_MONTHLY_INCOME_CENTS = 100_000_00;

export function validProfile(profile: ApplicantProfile, now: Date): ApplicantProfile {
  const { dateOfBirth, residenceCountry, declaredMonthlyIncome, employmentStatus } = profile;
  if (dateOfBirth !== null) {
    const born = new Date(`${dateOfBirth}T00:00:00Z`);
    if (
      !ISO_DATE.test(dateOfBirth) ||
      Number.isNaN(born.getTime()) ||
      !born.toISOString().startsWith(dateOfBirth) ||
      born.getTime() > now.getTime() ||
      ageInYears(dateOfBirth, now) > 120
    ) {
      throw new InvalidValueError(
        'dateOfBirth',
        'Date of birth must be a past date as YYYY-MM-DD.',
      );
    }
  }
  if (residenceCountry !== null && !COUNTRY.test(residenceCountry)) {
    throw new InvalidValueError('residenceCountry', 'Country must be an ISO 3166-1 alpha-2 code.');
  }
  if (
    declaredMonthlyIncome !== null &&
    (declaredMonthlyIncome.isNegative() || declaredMonthlyIncome.cents > MAX_MONTHLY_INCOME_CENTS)
  ) {
    throw new InvalidValueError(
      'declaredMonthlyIncome',
      'Monthly income must be between 0 and 100,000 EUR.',
    );
  }
  if (
    employmentStatus !== null &&
    !(EMPLOYMENT_STATUSES as readonly string[]).includes(employmentStatus)
  ) {
    throw new InvalidValueError(
      'employmentStatus',
      `Employment status must be one of ${EMPLOYMENT_STATUSES.join(', ')}.`,
    );
  }
  return profile;
}

export function missingFields(profile: ApplicantProfile): string[] {
  return (Object.keys(EMPTY_PROFILE) as (keyof ApplicantProfile)[]).filter(
    (field) => profile[field] === null,
  );
}

// Whole years lived on `now` (UTC): someone born on 2008-10-11 turns 18 on 2026-10-11.
export function ageInYears(dateOfBirth: string, now: Date): number {
  const [year = 0, month = 0, day = 0] = dateOfBirth.split('-').map(Number);
  const beforeBirthday =
    now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day);
  return now.getUTCFullYear() - year - (beforeBirthday ? 1 : 0);
}
