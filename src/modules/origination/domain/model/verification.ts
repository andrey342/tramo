import { type Money, type Percentage } from '@shared/domain';

export const VERIFICATION_TYPES = ['kyc', 'employment', 'bureau'] as const;
export type VerificationType = (typeof VERIFICATION_TYPES)[number];

// What each external provider answers. Providers are ports (application layer); these are the
// facts the application keeps once they have answered.
export interface KycResult {
  readonly verified: boolean;
  readonly confidence: Percentage;
  readonly reasons: readonly string[];
  readonly provider: string;
}

// "Vida laboral": the Social Security record of the last two years.
export interface EmploymentResult {
  readonly monthsWorkedLast24: number;
  readonly currentlyEmployed: boolean;
  readonly currentMonthlyIncome: Money | null;
  readonly provider: string;
}

export interface BureauResult {
  readonly listedInDefaultRegistry: boolean;
  // 0 (worst) to 1000 (best).
  readonly score: number;
  readonly provider: string;
}

export type Checked<T> = T & { readonly checkedAt: Date };

export interface Verifications {
  readonly kyc: Checked<KycResult> | null;
  readonly employment: Checked<EmploymentResult> | null;
  readonly bureau: Checked<BureauResult> | null;
}

export type VerificationResult =
  | { readonly type: 'kyc'; readonly result: KycResult }
  | { readonly type: 'employment'; readonly result: EmploymentResult }
  | { readonly type: 'bureau'; readonly result: BureauResult };

export const NO_VERIFICATIONS: Verifications = { kyc: null, employment: null, bureau: null };
