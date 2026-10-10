import { type CenterStatus, type VatValidationStatus } from '../../domain';

// A center as staff and the center itself see it. The payout account is masked: its full value
// only leaves the module for a disbursement.
export interface TrainingCenterDto {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly taxId: string;
  readonly status: CenterStatus;
  readonly vatValidation: {
    readonly status: VatValidationStatus;
    readonly checkedAt: Date;
    readonly provider: string;
    readonly registeredName: string | null;
  } | null;
  readonly payoutIbanMasked: string;
  readonly platformFeeBasisPoints: number;
  readonly createdAt: Date;
}
