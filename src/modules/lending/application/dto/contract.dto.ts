import {
  type CancellationReason,
  type CompletionReason,
  type ContractStatus,
  type DisbursementStatus,
  type PlanStatus,
} from '../../domain';

export type ContractProductDto =
  | {
      readonly kind: 'installments';
      readonly termMonths: number;
      readonly annualRateBasisPoints: number;
      readonly aprBasisPoints: number;
      readonly monthlyPaymentCents: number;
    }
  | {
      readonly kind: 'isa';
      readonly incomeShareBasisPoints: number;
      readonly minMonthlyIncomeCents: number;
      readonly maxPayments: number;
      readonly capCents: number;
      readonly graceMonths: number;
    };

// What the training center is paid: the center and staff see it, the student does not.
export interface PayoutDto {
  readonly platformFeeBasisPoints: number;
  readonly disbursementAmountCents: number;
  readonly disbursementStatus: DisbursementStatus | null;
  readonly settledAt: Date | null;
}

export interface ContractDto {
  readonly id: string;
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly program: { readonly id: string; readonly name: string; readonly durationWeeks: number };
  readonly principalCents: number;
  readonly currency: 'EUR';
  readonly product: ContractProductDto;
  readonly payout: PayoutDto | null;
  readonly signature: {
    readonly provider: string;
    readonly envelopeId: string;
    readonly documentHash: string;
    readonly sentAt: Date;
    readonly signedAt: Date | null;
  } | null;
  readonly status: ContractStatus;
  readonly activatedOn: string | null;
  readonly cancellationReason: CancellationReason | null;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

export interface ContractSummaryDto {
  readonly id: string;
  readonly applicationId: string;
  readonly studentId: string;
  readonly centerId: string;
  readonly programName: string;
  readonly principalCents: number;
  readonly product: 'installments' | 'isa';
  readonly status: ContractStatus;
  readonly statusChangedAt: Date;
  readonly createdAt: Date;
}

export interface ContractFilter {
  readonly studentId?: string;
  readonly centerId?: string;
  readonly status?: ContractStatus;
}

export interface InstallmentRowDto {
  readonly number: number;
  readonly dueDate: string;
  readonly principalCents: number;
  readonly interestCents: number;
  readonly totalCents: number;
  readonly balanceAfterCents: number;
  readonly paid: boolean;
}

export type ScheduleDto = {
  readonly contractId: string;
  readonly startsOn: string;
  readonly status: PlanStatus;
  readonly completionReason: CompletionReason | null;
} & (
  | {
      readonly kind: 'installments';
      readonly installmentsPaid: number;
      readonly installments: readonly InstallmentRowDto[];
      readonly payoffRequested: { readonly amountCents: number; readonly asOf: string } | null;
    }
  | {
      readonly kind: 'isa';
      readonly incomeShareBasisPoints: number;
      readonly minMonthlyIncomeCents: number;
      readonly maxPayments: number;
      readonly capCents: number;
      readonly firstPeriod: string;
      readonly windowEndsOn: string;
      readonly chargedSoFarCents: number;
      readonly paymentsMade: number;
      readonly declarationOverdue: boolean;
      // Why no more months are assessed, if so; the plan ends once the months charged are
      // collected (those still owed are listed).
      readonly assessmentsEnded: 'cap_reached' | 'max_payments' | 'window_expired' | null;
      readonly uncollectedPeriods: readonly string[];
    }
);

export interface PayoffQuoteDto {
  readonly contractId: string;
  readonly asOf: string;
  readonly overdueInstallments: number;
  readonly overdueAmountCents: number;
  readonly outstandingPrincipalCents: number;
  readonly accruedInterestCents: number;
  readonly totalCents: number;
}

export interface DisbursementDto {
  readonly id: string;
  readonly contractId: string;
  readonly centerId: string;
  readonly amountCents: number;
  readonly attempt: number;
  readonly status: DisbursementStatus;
  readonly failureReason: string | null;
  readonly statusChangedAt: Date;
  readonly settledAt: Date | null;
  readonly createdAt: Date;
}

export interface DisbursementFilter {
  readonly status?: DisbursementStatus;
}
