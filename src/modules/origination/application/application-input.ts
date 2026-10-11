import { Money, NationalId, unwrap } from '@shared/domain';

import { type ApplicantProfile, type EmploymentStatus } from '../domain';

// What clients send about the applicant, in plain values; turned into domain values here so
// commands stay free of HTTP types. Every field is optional while the application is a draft.
export interface ProfileInput {
  readonly dateOfBirth?: string;
  readonly nationalId?: string;
  readonly residenceCountry?: string;
  readonly declaredMonthlyIncomeCents?: number;
  readonly employmentStatus?: EmploymentStatus;
}

export function toProfileChanges(input: ProfileInput): Partial<ApplicantProfile> {
  return {
    ...(input.dateOfBirth !== undefined && { dateOfBirth: input.dateOfBirth }),
    ...(input.nationalId !== undefined && {
      nationalId: unwrap(NationalId.create(input.nationalId)),
    }),
    ...(input.residenceCountry !== undefined && {
      residenceCountry: input.residenceCountry.toUpperCase(),
    }),
    ...(input.declaredMonthlyIncomeCents !== undefined && {
      declaredMonthlyIncome: Money.fromCents(input.declaredMonthlyIncomeCents),
    }),
    ...(input.employmentStatus !== undefined && { employmentStatus: input.employmentStatus }),
  };
}
