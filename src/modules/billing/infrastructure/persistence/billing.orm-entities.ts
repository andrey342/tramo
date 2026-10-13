import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import {
  type ChargeKind,
  type ChargeStatus,
  type IncomeSource,
  type MandateStatus,
} from '../../domain';

export interface CollectionAttemptJson {
  readonly number: number;
  readonly key: string;
  readonly mandateId: string;
  readonly submittedAt: string;
  readonly paymentId: string | null;
  readonly outcome: 'pending' | 'succeeded' | 'failed' | 'returned';
  readonly failureReason: string | null;
  readonly settledAt: string | null;
}

@Entity({ schema: 'billing', name: 'payment_mandates' })
export class PaymentMandateOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  // lending's contract and iam's student (no cross-schema keys, ADR 008).
  @Column('uuid', { name: 'contract_id' })
  contractId: string;

  @Column('uuid', { name: 'student_id' })
  studentId: string;

  // Encrypted, bound to the row (ADR 014).
  @Column('text', { name: 'iban_encrypted' })
  ibanEncrypted: string;

  @Column('text')
  reference: string;

  @Column('text')
  status: MandateStatus;

  @Column({ type: 'timestamptz', name: 'signed_at', precision: 3 })
  signedAt: Date;

  @Column({ type: 'timestamptz', name: 'revoked_at', precision: 3, nullable: true })
  revokedAt: Date | null;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

@Entity({ schema: 'billing', name: 'charges' })
export class ChargeOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'contract_id' })
  contractId: string;

  @Column('uuid', { name: 'student_id' })
  studentId: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('text')
  kind: ChargeKind;

  @Column('text')
  reference: string;

  @Column('integer', { name: 'installment_number', nullable: true })
  installmentNumber: number | null;

  @Column('text')
  period: string;

  @Column('integer', { name: 'amount_cents' })
  amountCents: number;

  @Column('date', { name: 'due_date' })
  dueDate: string;

  @Column('text')
  status: ChargeStatus;

  @Column('jsonb')
  attempts: CollectionAttemptJson[];

  @Column('integer', { name: 'dunning_step' })
  dunningStep: number;

  @Column({ type: 'timestamptz', name: 'paid_at', precision: 3, nullable: true })
  paidAt: Date | null;

  @Column({ type: 'timestamptz', name: 'status_changed_at', precision: 3 })
  statusChangedAt: Date;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

@Entity({ schema: 'billing', name: 'income_declarations' })
export class IncomeDeclarationOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'contract_id' })
  contractId: string;

  @Column('uuid', { name: 'student_id' })
  studentId: string;

  @Column('text')
  period: string;

  @Column('integer', { name: 'gross_monthly_income_cents' })
  grossMonthlyIncomeCents: number;

  @Column('text')
  source: IncomeSource;

  @Column({ type: 'timestamptz', name: 'declared_at', precision: 3 })
  declaredAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

// Projection of charge events: written by a consumer, read by the statement.
@Entity({ schema: 'billing', name: 'ledger_entries' })
export class LedgerEntryOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'event_id' })
  eventId: string;

  @Column('uuid', { name: 'contract_id' })
  contractId: string;

  @Column('uuid', { name: 'charge_id' })
  chargeId: string;

  @Column('text')
  type: 'charge' | 'payment' | 'return' | 'write_off' | 'cancellation';

  @Column('integer', { name: 'amount_cents' })
  amountCents: number;

  @Column('text')
  description: string;

  @Column({ type: 'timestamptz', name: 'occurred_at', precision: 3 })
  occurredAt: Date;
}
