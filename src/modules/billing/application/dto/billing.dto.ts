import { type ChargeKind, type ChargeStatus, type MandateStatus } from '../../domain';

export interface MandateDto {
  readonly id: string;
  readonly contractId: string;
  readonly reference: string;
  readonly ibanMasked: string;
  readonly status: MandateStatus;
  readonly signedAt: Date;
}

export interface IncomeDeclarationDto {
  readonly id: string;
  readonly contractId: string;
  readonly period: string;
  readonly grossMonthlyIncomeCents: number;
  readonly source: 'self' | 'employment_provider';
  readonly declaredAt: Date;
}

export interface ChargeDto {
  readonly id: string;
  readonly contractId: string;
  readonly kind: ChargeKind;
  readonly installmentNumber: number | null;
  readonly period: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly status: ChargeStatus;
  readonly attempts: number;
  readonly lastFailureReason: string | null;
  readonly paidAt: Date | null;
  readonly createdAt: Date;
}

export type LedgerEntryType = 'charge' | 'payment' | 'write_off' | 'cancellation';

export interface LedgerEntryDto {
  readonly occurredAt: Date;
  readonly type: LedgerEntryType;
  readonly chargeId: string;
  readonly description: string;
  // Positive: owed by the student; negative: paid, or no longer owed.
  readonly amountCents: number;
  readonly balanceCents: number;
}

export interface StatementDto {
  readonly contractId: string;
  readonly entries: readonly LedgerEntryDto[];
  readonly balanceCents: number;
}

export interface BillingRunDto {
  readonly asOf: string;
  readonly plansBilled: number;
  readonly chargesCreated: number;
  readonly failedContractIds: readonly string[];
  readonly collectionsSubmitted: number;
}

export interface DunningRunDto {
  readonly asOf: string;
  readonly chargesReviewed: number;
  readonly retries: number;
}
