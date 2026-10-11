import { Column, Entity, PrimaryColumn } from 'typeorm';

// One row per version, never updated (the repository only inserts).
@Entity({ schema: 'origination', name: 'risk_policies' })
export class RiskPolicyOrmEntity {
  @PrimaryColumn('integer')
  version: number;

  @Column('integer', { name: 'max_financeable_cents' })
  maxFinanceableCents: number;

  @Column('integer', { name: 'min_age_years' })
  minAgeYears: number;

  @Column('text', { name: 'allowed_residence_countries', array: true })
  allowedResidenceCountries: string[];

  @Column('integer', { name: 'weight_employability_bps' })
  weightEmployabilityBps: number;

  @Column('integer', { name: 'weight_employment_history_bps' })
  weightEmploymentHistoryBps: number;

  @Column('integer', { name: 'weight_affordability_bps' })
  weightAffordabilityBps: number;

  @Column('integer', { name: 'weight_bureau_bps' })
  weightBureauBps: number;

  @Column('integer', { name: 'approve_threshold' })
  approveThreshold: number;

  @Column('integer', { name: 'review_threshold' })
  reviewThreshold: number;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @Column('text', { name: 'created_by' })
  createdBy: string;
}
