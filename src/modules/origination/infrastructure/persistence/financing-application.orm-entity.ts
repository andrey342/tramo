import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import {
  type ApplicationOrigin,
  type ApplicationStatus,
  type EmploymentStatus,
  type HardRule,
  type ScoreFactorName,
} from '../../domain';

// JSON documents for what is only read back whole (the program as applied for, provider answers,
// the decision record); columns for what lists filter, sort or show.
export interface ProgramSnapshotJson {
  readonly name: string;
  readonly priceCents: number;
  readonly employabilityBps: number;
  readonly avgStartingSalaryCents: number;
  readonly installments: { readonly allowedTerms: number[]; readonly annualRateBps: number } | null;
  readonly isa: {
    readonly incomeShareBps: number;
    readonly minMonthlyIncomeCents: number;
    readonly maxPayments: number;
    readonly capMultiplierHundredths: number;
    readonly graceMonths: number;
  } | null;
}

export interface KycJson {
  readonly verified: boolean;
  readonly confidenceBps: number;
  readonly reasons: string[];
  readonly provider: string;
  readonly checkedAt: string;
}

export interface EmploymentJson {
  readonly monthsWorkedLast24: number;
  readonly currentlyEmployed: boolean;
  readonly currentMonthlyIncomeCents: number | null;
  readonly provider: string;
  readonly checkedAt: string;
}

export interface BureauJson {
  readonly listedInDefaultRegistry: boolean;
  readonly score: number;
  readonly provider: string;
  readonly checkedAt: string;
}

export interface DecisionJson {
  readonly outcome: 'approved' | 'needs_review' | 'rejected';
  readonly score: number;
  readonly factors: {
    readonly name: ScoreFactorName;
    readonly weightBps: number;
    readonly value: number;
    readonly points: number;
  }[];
  readonly hardRulesBroken: HardRule[];
  readonly reasons: string[];
  readonly estimatedMonthlyPaymentCents: number;
  readonly policyVersion: number;
  readonly decidedAt: string;
}

export interface ManualDecisionJson {
  readonly outcome: 'approved' | 'rejected';
  readonly reason: string;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

@Entity({ schema: 'origination', name: 'financing_applications' })
export class FinancingApplicationOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  // iam's user id (no cross-schema key, ADR 008).
  @Column('uuid', { name: 'applicant_id' })
  applicantId: string;

  @Column('text')
  origin: ApplicationOrigin;

  // catalog's ids, kept as they were when the student applied.
  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('uuid', { name: 'program_id' })
  programId: string;

  @Column('jsonb', { name: 'program_snapshot' })
  programSnapshot: ProgramSnapshotJson;

  @Column('text')
  product: 'installments' | 'isa';

  @Column('integer', { name: 'term_months', nullable: true })
  termMonths: number | null;

  // `YYYY-MM-DD`, as text for the same reason as catalog's start dates.
  @Column('text', { name: 'date_of_birth', nullable: true })
  dateOfBirth: string | null;

  // Personal data: encrypted (ADR 014), bound to the row.
  @Column('text', { name: 'national_id_encrypted', nullable: true })
  nationalIdEncrypted: string | null;

  @Column('text', { name: 'residence_country', nullable: true })
  residenceCountry: string | null;

  @Column('integer', { name: 'declared_monthly_income_cents', nullable: true })
  declaredMonthlyIncomeCents: number | null;

  @Column('text', { name: 'employment_status', nullable: true })
  employmentStatus: EmploymentStatus | null;

  @Column('jsonb', { nullable: true })
  kyc: KycJson | null;

  @Column('jsonb', { nullable: true })
  employment: EmploymentJson | null;

  @Column('jsonb', { nullable: true })
  bureau: BureauJson | null;

  @Column('jsonb', { nullable: true })
  decision: DecisionJson | null;

  @Column('jsonb', { name: 'manual_decision', nullable: true })
  manualDecision: ManualDecisionJson | null;

  // Copied out of `decision` for lists.
  @Column('numeric', {
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | null) => (value === null ? null : Number(value)),
    },
  })
  score: number | null;

  @Column('text')
  status: ApplicationStatus;

  @Column({ type: 'timestamptz', name: 'status_changed_at', precision: 3 })
  statusChangedAt: Date;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}
