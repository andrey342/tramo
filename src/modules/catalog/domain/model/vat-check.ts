// What a VAT registry answered about a number. `unavailable` is not a verdict: the registry could
// not be asked (down, timing out, circuit open), so the center stays as it was, marked unverified.
export type VatCheckResult =
  | {
      readonly outcome: 'valid';
      readonly provider: string;
      readonly registeredName: string | null;
    }
  | { readonly outcome: 'invalid'; readonly provider: string }
  | { readonly outcome: 'unavailable'; readonly provider: string; readonly reason: string };

export type VatValidationStatus = 'valid' | 'invalid' | 'unverified';

// The latest check, as kept on the center.
export interface VatValidation {
  readonly status: VatValidationStatus;
  readonly checkedAt: Date;
  readonly provider: string;
  readonly registeredName: string | null;
}
