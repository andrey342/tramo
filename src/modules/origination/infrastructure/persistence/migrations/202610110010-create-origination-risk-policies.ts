import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateOriginationRiskPolicies1791677400000 implements MigrationInterface {
  name = 'CreateOriginationRiskPolicies1791677400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE origination.risk_policies (
        version integer NOT NULL CONSTRAINT ck_origination_risk_policies_version CHECK (version > 0),
        max_financeable_cents integer NOT NULL
          CONSTRAINT ck_origination_risk_policies_max_financeable_cents CHECK (max_financeable_cents > 0),
        min_age_years integer NOT NULL CONSTRAINT ck_origination_risk_policies_min_age_years
          CHECK (min_age_years BETWEEN 18 AND 99),
        allowed_residence_countries text[] NOT NULL
          CONSTRAINT ck_origination_risk_policies_allowed_residence_countries
          CHECK (cardinality(allowed_residence_countries) > 0),
        weight_employability_bps integer NOT NULL
          CONSTRAINT ck_origination_risk_policies_weight_employability_bps
          CHECK (weight_employability_bps BETWEEN 0 AND 10000),
        weight_employment_history_bps integer NOT NULL
          CONSTRAINT ck_origination_risk_policies_weight_employment_history_bps
          CHECK (weight_employment_history_bps BETWEEN 0 AND 10000),
        weight_affordability_bps integer NOT NULL
          CONSTRAINT ck_origination_risk_policies_weight_affordability_bps
          CHECK (weight_affordability_bps BETWEEN 0 AND 10000),
        weight_bureau_bps integer NOT NULL CONSTRAINT ck_origination_risk_policies_weight_bureau_bps
          CHECK (weight_bureau_bps BETWEEN 0 AND 10000),
        approve_threshold integer NOT NULL,
        review_threshold integer NOT NULL,
        created_at timestamptz(3) NOT NULL,
        -- iam.users.id of the admin, or 'system' for the version below.
        created_by text NOT NULL,
        CONSTRAINT pk_origination_risk_policies PRIMARY KEY (version),
        CONSTRAINT ck_origination_risk_policies_weights CHECK (
          weight_employability_bps + weight_employment_history_bps + weight_affordability_bps
            + weight_bureau_bps = 10000
        ),
        CONSTRAINT ck_origination_risk_policies_thresholds CHECK (
          0 <= review_threshold AND review_threshold < approve_threshold AND approve_threshold <= 100
        )
      )
    `);
    // Version 1, the rules Tramo launched with (RiskPolicy.initial): up to 12,000 EUR, adults
    // living in Spain, weights 40/25/20/15, approve from 70, review from 50.
    await queryRunner.query(`
      INSERT INTO origination.risk_policies (
        version, max_financeable_cents, min_age_years, allowed_residence_countries,
        weight_employability_bps, weight_employment_history_bps, weight_affordability_bps,
        weight_bureau_bps, approve_threshold, review_threshold, created_at, created_by
      ) VALUES (1, 1200000, 18, ARRAY['ES'], 4000, 2500, 2000, 1500, 70, 50, now(), 'system')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE origination.risk_policies`);
  }
}
