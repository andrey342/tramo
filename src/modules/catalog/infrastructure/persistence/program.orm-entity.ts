import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { type ProgramModality, type ProgramStatus } from '../../domain';

// Financing options are columns, not a JSON document: the database can check their ranges and the
// public catalog filters on them.
@Entity({ schema: 'catalog', name: 'programs' })
export class ProgramOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('text')
  name: string;

  @Column('text')
  modality: ProgramModality;

  @Column('integer', { name: 'price_cents' })
  priceCents: number;

  @Column('integer', { name: 'duration_weeks' })
  durationWeeks: number;

  // `YYYY-MM-DD` strings: TypeORM would turn `date` values into JS Dates at local midnight.
  @Column('text', { name: 'start_dates', array: true })
  startDates: string[];

  @Column('integer', { name: 'employability_bps' })
  employabilityBps: number;

  @Column('integer', { name: 'avg_starting_salary_cents' })
  avgStartingSalaryCents: number;

  @Column('integer', { name: 'installment_terms', array: true, nullable: true })
  installmentTerms: number[] | null;

  @Column('integer', { name: 'installment_rate_bps', nullable: true })
  installmentRateBps: number | null;

  @Column('integer', { name: 'isa_income_share_bps', nullable: true })
  isaIncomeShareBps: number | null;

  @Column('integer', { name: 'isa_min_monthly_income_cents', nullable: true })
  isaMinMonthlyIncomeCents: number | null;

  @Column('integer', { name: 'isa_max_payments', nullable: true })
  isaMaxPayments: number | null;

  @Column('integer', { name: 'isa_cap_multiplier_hundredths', nullable: true })
  isaCapMultiplierHundredths: number | null;

  @Column('integer', { name: 'isa_grace_months', nullable: true })
  isaGraceMonths: number | null;

  @Column('text')
  status: ProgramStatus;

  @Column({ type: 'timestamptz', name: 'published_at', precision: 3, nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}
