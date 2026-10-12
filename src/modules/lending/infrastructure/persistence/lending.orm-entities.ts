import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import {
  type CancellationReason,
  type CompletionReason,
  type ContractStatus,
  type DisbursementStatus,
  type PlanStatus,
} from '../../domain';

// JSON documents for what is only read back whole (the product terms, the instalment table, the
// state of an ISA); columns for what lists filter, sort or show.
export type ProductTermsJson =
  | { readonly kind: 'installments'; readonly termMonths: number; readonly annualRateBps: number }
  | {
      readonly kind: 'isa';
      readonly incomeShareBps: number;
      readonly minMonthlyIncomeCents: number;
      readonly maxPayments: number;
      readonly capMultiplierHundredths: number;
      readonly graceMonths: number;
    };

export interface InstallmentRowJson {
  readonly number: number;
  readonly dueDate: string;
  readonly principalCents: number;
  readonly interestCents: number;
  readonly totalCents: number;
  readonly balanceAfterCents: number;
}

export type PlanTermsJson =
  | {
      readonly kind: 'installments';
      readonly annualRateBps: number;
      readonly termMonths: number;
      readonly schedule: InstallmentRowJson[];
      readonly installmentsPaid: number;
      readonly payoffRequest: {
        readonly amountCents: number;
        readonly asOf: string;
        readonly requestedAt: string;
      } | null;
    }
  | {
      readonly kind: 'isa';
      readonly incomeShareBps: number;
      readonly minMonthlyIncomeCents: number;
      readonly maxPayments: number;
      readonly capCents: number;
      readonly firstPeriod: string;
      readonly windowEndsOn: string;
      readonly chargedSoFarCents: number;
      readonly paymentsMade: number;
      readonly consecutiveMissingDeclarations: number;
      readonly declarationOverdue: boolean;
      readonly lastAssessedPeriod: string | null;
    };

@Entity({ schema: 'lending', name: 'contracts' })
export class ContractOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  // origination's application, iam's student and catalog's center and program (no cross-schema
  // keys, ADR 008).
  @Column('uuid', { name: 'application_id' })
  applicationId: string;

  @Column('uuid', { name: 'student_id' })
  studentId: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('uuid', { name: 'program_id' })
  programId: string;

  @Column('text', { name: 'program_name' })
  programName: string;

  @Column('integer', { name: 'program_duration_weeks' })
  programDurationWeeks: number;

  @Column('integer', { name: 'principal_cents' })
  principalCents: number;

  @Column('integer', { name: 'platform_fee_bps' })
  platformFeeBps: number;

  @Column('text')
  product: 'installments' | 'isa';

  @Column('jsonb', { name: 'product_terms' })
  productTerms: ProductTermsJson;

  @Column('text', { name: 'signature_provider', nullable: true })
  signatureProvider: string | null;

  @Column('text', { name: 'envelope_id', nullable: true })
  envelopeId: string | null;

  @Column('text', { name: 'document_hash', nullable: true })
  documentHash: string | null;

  @Column({ type: 'timestamptz', name: 'sent_for_signature_at', precision: 3, nullable: true })
  sentForSignatureAt: Date | null;

  @Column({ type: 'timestamptz', name: 'signed_at', precision: 3, nullable: true })
  signedAt: Date | null;

  // `YYYY-MM-DD`: the pg driver returns date columns as text.
  @Column('date', { name: 'activated_on', nullable: true })
  activatedOn: string | null;

  @Column('text', { name: 'cancellation_reason', nullable: true })
  cancellationReason: CancellationReason | null;

  @Column('text')
  status: ContractStatus;

  @Column({ type: 'timestamptz', name: 'status_changed_at', precision: 3 })
  statusChangedAt: Date;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

@Entity({ schema: 'lending', name: 'disbursements' })
export class DisbursementOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'contract_id' })
  contractId: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('integer', { name: 'amount_cents' })
  amountCents: number;

  @Column('integer')
  attempt: number;

  // Who the current attempt pays, once its transfer started. Encrypted, bound to the row (ADR 014).
  @Column('text', { name: 'creditor_iban_encrypted', nullable: true })
  creditorIbanEncrypted: string | null;

  @Column('text', { name: 'creditor_name', nullable: true })
  creditorName: string | null;

  @Column('text', { name: 'transfer_id', nullable: true })
  transferId: string | null;

  @Column('text', { name: 'failure_reason', nullable: true })
  failureReason: string | null;

  @Column('text')
  status: DisbursementStatus;

  @Column({ type: 'timestamptz', name: 'status_changed_at', precision: 3 })
  statusChangedAt: Date;

  @Column({ type: 'timestamptz', name: 'settled_at', precision: 3, nullable: true })
  settledAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

@Entity({ schema: 'lending', name: 'financing_plans' })
export class FinancingPlanOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'contract_id' })
  contractId: string;

  @Column('uuid', { name: 'student_id' })
  studentId: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('text')
  kind: 'installments' | 'isa';

  @Column('integer', { name: 'principal_cents' })
  principalCents: number;

  @Column('date', { name: 'starts_on' })
  startsOn: string;

  @Column('jsonb')
  terms: PlanTermsJson;

  @Column('text')
  status: PlanStatus;

  @Column('text', { name: 'completion_reason', nullable: true })
  completionReason: CompletionReason | null;

  @Column({ type: 'timestamptz', name: 'completed_at', precision: 3, nullable: true })
  completedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}
