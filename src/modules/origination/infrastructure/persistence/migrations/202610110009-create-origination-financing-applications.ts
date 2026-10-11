import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateOriginationFinancingApplications1791677340000 implements MigrationInterface {
  name = 'CreateOriginationFinancingApplications1791677340000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE origination.financing_applications (
        id uuid NOT NULL,
        -- iam.users.id, catalog.training_centers.id and catalog.programs.id: other schemas, so
        -- not foreign keys (ADR 008).
        applicant_id uuid NOT NULL,
        origin text NOT NULL CONSTRAINT ck_origination_financing_applications_origin
          CHECK (origin IN ('student', 'center')),
        center_id uuid NOT NULL,
        program_id uuid NOT NULL,
        program_snapshot jsonb NOT NULL
          CONSTRAINT ck_origination_financing_applications_program_snapshot
          CHECK (jsonb_typeof(program_snapshot) = 'object'
                 AND (program_snapshot ->> 'priceCents')::integer > 0),
        product text NOT NULL CONSTRAINT ck_origination_financing_applications_product
          CHECK (product IN ('installments', 'isa')),
        term_months integer NULL CONSTRAINT ck_origination_financing_applications_term_months
          CHECK (term_months BETWEEN 6 AND 48),
        date_of_birth text NULL CONSTRAINT ck_origination_financing_applications_date_of_birth
          CHECK (date_of_birth ~ '^\\d{4}-\\d{2}-\\d{2}$'),
        national_id_encrypted text NULL,
        residence_country text NULL CONSTRAINT ck_origination_financing_applications_residence_country
          CHECK (residence_country ~ '^[A-Z]{2}$'),
        declared_monthly_income_cents integer NULL
          CONSTRAINT ck_origination_financing_applications_declared_monthly_income_cents
          CHECK (declared_monthly_income_cents >= 0),
        employment_status text NULL CONSTRAINT ck_origination_financing_applications_employment_status
          CHECK (employment_status IN ('employed', 'self_employed', 'unemployed', 'student')),
        kyc jsonb NULL,
        employment jsonb NULL,
        bureau jsonb NULL,
        decision jsonb NULL,
        manual_decision jsonb NULL,
        score numeric(5, 2) NULL CONSTRAINT ck_origination_financing_applications_score
          CHECK (score BETWEEN 0 AND 100),
        status text NOT NULL CONSTRAINT ck_origination_financing_applications_status
          CHECK (status IN ('draft', 'submitted', 'verifying', 'scoring', 'approved', 'needs_review',
                            'rejected', 'offer_accepted', 'cancelled', 'expired')),
        status_changed_at timestamptz(3) NOT NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_origination_financing_applications_version
          CHECK (version > 0),
        CONSTRAINT pk_origination_financing_applications PRIMARY KEY (id),
        -- Instalments name a term; an ISA does not.
        CONSTRAINT ck_origination_financing_applications_term CHECK (
          (product = 'installments') = (term_months IS NOT NULL)
        ),
        -- Mirrors the domain: past the draft, the applicant's profile is complete.
        CONSTRAINT ck_origination_financing_applications_profile_complete CHECK (
          status = 'draft'
          OR num_nulls(date_of_birth, national_id_encrypted, residence_country,
                       declared_monthly_income_cents, employment_status) = 0
        ),
        -- A decided application keeps the engine's decision record and its score (an analyst's
        -- decision comes on top of a review the engine asked for).
        CONSTRAINT ck_origination_financing_applications_decided CHECK (
          status NOT IN ('approved', 'needs_review', 'rejected', 'offer_accepted')
          OR (decision IS NOT NULL AND score IS NOT NULL)
        )
      )
    `);
    // A student's applications, a center's and everyone's (staff), newest first, each filtered
    // by status at most; all paginated on (created_at, id).
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_applicant_id_created_at_id
        ON origination.financing_applications (applicant_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_center_id_created_at_id
        ON origination.financing_applications (center_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_status_created_at_id
        ON origination.financing_applications (status, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_created_at_id
        ON origination.financing_applications (created_at DESC, id DESC)
    `);
    // The review queue, longest waiting first.
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_review_queue
        ON origination.financing_applications (status_changed_at, id)
        WHERE status = 'needs_review'
    `);
    // The expiry sweep: applications not final, by how long they have not moved.
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_open_status_changed_at
        ON origination.financing_applications (status_changed_at, id)
        WHERE status NOT IN ('rejected', 'offer_accepted', 'cancelled', 'expired')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE origination.financing_applications`);
  }
}
