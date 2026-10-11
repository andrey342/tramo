import {
  type ApplicationOrigin,
  type ApplicationStatus,
  type DecisionOutcome,
  type EmploymentStatus,
  type HardRule,
  type ScoreFactorName,
} from '../../domain';

export type RequestedProductDto =
  { readonly kind: 'installments'; readonly termMonths: number } | { readonly kind: 'isa' };

// Personal data: only the student and Tramo's staff see it, never the training center.
export type ApplicantProfileDto = {
  readonly dateOfBirth: string | null;
  readonly nationalIdMasked: string | null;
  readonly residenceCountry: string | null;
  readonly declaredMonthlyIncomeCents: number | null;
  readonly employmentStatus: EmploymentStatus | null;
};

export interface ApplicationDto {
  readonly id: string;
  readonly applicantId: string;
  readonly centerId: string;
  readonly origin: ApplicationOrigin;
  readonly programId: string;
  readonly programName: string;
  readonly amountCents: number;
  readonly currency: 'EUR';
  readonly product: RequestedProductDto;
  readonly profile: ApplicantProfileDto | null;
  readonly verificationsCompleted: readonly ('kyc' | 'employment' | 'bureau')[];
  readonly status: ApplicationStatus;
  readonly score: number | null;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

export interface ApplicationSummaryDto {
  readonly id: string;
  readonly applicantId: string;
  readonly centerId: string;
  readonly programId: string;
  readonly programName: string;
  readonly amountCents: number;
  readonly product: 'installments' | 'isa';
  readonly status: ApplicationStatus;
  readonly score: number | null;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

export interface ApplicationFilter {
  readonly applicantId?: string;
  readonly centerId?: string;
  readonly status?: ApplicationStatus;
}

// The explanation of a decision, for the student and for ops.
export interface DecisionDto {
  readonly outcome: DecisionOutcome;
  readonly score: number;
  readonly factors: readonly {
    readonly name: ScoreFactorName;
    readonly weightBasisPoints: number;
    readonly value: number;
    readonly points: number;
  }[];
  readonly hardRulesBroken: readonly HardRule[];
  readonly reasons: readonly string[];
  readonly estimatedMonthlyPaymentCents: number;
  readonly policyVersion: number;
  readonly decidedAt: Date;
  // Set when an analyst settled a review; it is the final outcome.
  readonly manualDecision: {
    readonly outcome: 'approved' | 'rejected';
    readonly reason: string;
    readonly decidedAt: Date;
  } | null;
}
