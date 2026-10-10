import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateCatalogPrograms1791668520000 implements MigrationInterface {
  name = 'CreateCatalogPrograms1791668520000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE catalog.programs (
        id uuid NOT NULL,
        center_id uuid NOT NULL,
        name text NOT NULL CONSTRAINT ck_catalog_programs_name CHECK (length(name) BETWEEN 1 AND 200),
        modality text NOT NULL CONSTRAINT ck_catalog_programs_modality
          CHECK (modality IN ('online', 'onsite', 'hybrid')),
        price_cents integer NOT NULL CONSTRAINT ck_catalog_programs_price_cents
          CHECK (price_cents > 0 AND price_cents <= 10000000),
        duration_weeks integer NOT NULL CONSTRAINT ck_catalog_programs_duration_weeks
          CHECK (duration_weeks BETWEEN 1 AND 156),
        start_dates text[] NOT NULL CONSTRAINT ck_catalog_programs_start_dates
          CHECK (cardinality(start_dates) <= 24),
        employability_bps integer NOT NULL CONSTRAINT ck_catalog_programs_employability_bps
          CHECK (employability_bps BETWEEN 0 AND 10000),
        avg_starting_salary_cents integer NOT NULL
          CONSTRAINT ck_catalog_programs_avg_starting_salary_cents CHECK (avg_starting_salary_cents >= 0),
        -- Instalment loan: terms of 6 to 48 months and the annual rate, both or neither.
        installment_terms integer[] NULL CONSTRAINT ck_catalog_programs_installment_terms
          CHECK (cardinality(installment_terms) > 0 AND 6 <= ALL (installment_terms) AND 48 >= ALL (installment_terms)),
        installment_rate_bps integer NULL CONSTRAINT ck_catalog_programs_installment_rate_bps
          CHECK (installment_rate_bps BETWEEN 0 AND 2500),
        -- Income share agreement: all five columns or none.
        isa_income_share_bps integer NULL CONSTRAINT ck_catalog_programs_isa_income_share_bps
          CHECK (isa_income_share_bps BETWEEN 1 AND 2000),
        isa_min_monthly_income_cents integer NULL
          CONSTRAINT ck_catalog_programs_isa_min_monthly_income_cents CHECK (isa_min_monthly_income_cents > 0),
        isa_max_payments integer NULL CONSTRAINT ck_catalog_programs_isa_max_payments
          CHECK (isa_max_payments BETWEEN 1 AND 120),
        isa_cap_multiplier_hundredths integer NULL
          CONSTRAINT ck_catalog_programs_isa_cap_multiplier_hundredths
          CHECK (isa_cap_multiplier_hundredths BETWEEN 100 AND 200),
        isa_grace_months integer NULL CONSTRAINT ck_catalog_programs_isa_grace_months
          CHECK (isa_grace_months BETWEEN 0 AND 12),
        status text NOT NULL CONSTRAINT ck_catalog_programs_status
          CHECK (status IN ('draft', 'published', 'archived')),
        published_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_catalog_programs_version CHECK (version > 0),
        CONSTRAINT pk_catalog_programs PRIMARY KEY (id),
        -- Same schema, so the reference is enforced (ADR 008 only rules out cross-schema keys).
        CONSTRAINT fk_catalog_programs_center FOREIGN KEY (center_id)
          REFERENCES catalog.training_centers (id),
        CONSTRAINT ck_catalog_programs_installments_complete CHECK (
          (installment_terms IS NULL) = (installment_rate_bps IS NULL)
        ),
        CONSTRAINT ck_catalog_programs_isa_complete CHECK (
          num_nulls(isa_income_share_bps, isa_min_monthly_income_cents, isa_max_payments,
                    isa_cap_multiplier_hundredths, isa_grace_months) IN (0, 5)
        ),
        -- Mirrors the domain: an ISA needs at least 60 % employability; a published program has
        -- a financing option and a publication date.
        CONSTRAINT ck_catalog_programs_isa_employability CHECK (
          isa_income_share_bps IS NULL OR employability_bps >= 6000
        ),
        CONSTRAINT ck_catalog_programs_published CHECK (
          status <> 'published'
          OR (published_at IS NOT NULL AND (installment_terms IS NOT NULL OR isa_income_share_bps IS NOT NULL))
        )
      )
    `);
    await queryRunner.query(
      `CREATE INDEX ix_catalog_programs_center_id ON catalog.programs (center_id)`,
    );
    // The public catalog: published programs, newest first, paginated on (created_at, id).
    await queryRunner.query(`
      CREATE INDEX ix_catalog_programs_published_created_at_id
        ON catalog.programs (created_at DESC, id DESC) WHERE status = 'published'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE catalog.programs`);
  }
}
