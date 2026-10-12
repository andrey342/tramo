import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateLendingContracts1791828960000 implements MigrationInterface {
  name = 'CreateLendingContracts1791828960000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lending.contracts (
        id uuid NOT NULL,
        -- origination's application, iam's student, catalog's center and program: other schemas,
        -- so not foreign keys (ADR 008).
        application_id uuid NOT NULL,
        student_id uuid NOT NULL,
        center_id uuid NOT NULL,
        program_id uuid NOT NULL,
        program_name text NOT NULL,
        program_duration_weeks integer NOT NULL
          CONSTRAINT ck_lending_contracts_program_duration_weeks CHECK (program_duration_weeks > 0),
        principal_cents integer NOT NULL
          CONSTRAINT ck_lending_contracts_principal_cents CHECK (principal_cents > 0),
        platform_fee_bps integer NOT NULL
          CONSTRAINT ck_lending_contracts_platform_fee_bps CHECK (platform_fee_bps BETWEEN 0 AND 10000),
        product text NOT NULL CONSTRAINT ck_lending_contracts_product
          CHECK (product IN ('installments', 'isa')),
        product_terms jsonb NOT NULL CONSTRAINT ck_lending_contracts_product_terms
          CHECK (jsonb_typeof(product_terms) = 'object' AND product_terms ->> 'kind' = product),
        signature_provider text NULL,
        envelope_id text NULL,
        document_hash text NULL CONSTRAINT ck_lending_contracts_document_hash
          CHECK (document_hash ~ '^[0-9a-f]{64}$'),
        sent_for_signature_at timestamptz(3) NULL,
        signed_at timestamptz(3) NULL,
        activated_on date NULL,
        cancellation_reason text NULL CONSTRAINT ck_lending_contracts_cancellation_reason
          CHECK (cancellation_reason IN ('signature_declined', 'signature_expired')),
        status text NOT NULL CONSTRAINT ck_lending_contracts_status
          CHECK (status IN ('draft', 'sent_for_signature', 'signed', 'active', 'completed',
                            'defaulted', 'cancelled')),
        status_changed_at timestamptz(3) NOT NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_lending_contracts_version CHECK (version > 0),
        CONSTRAINT pk_lending_contracts PRIMARY KEY (id),
        -- The envelope is sent as a whole: provider, id, hash and time together.
        CONSTRAINT ck_lending_contracts_envelope CHECK (
          num_nulls(signature_provider, envelope_id, document_hash, sent_for_signature_at) IN (0, 4)
        ),
        -- Mirrors the domain: past the draft there is an envelope, once signed a signature, once
        -- active a start day, and only a cancelled contract has a cancellation reason.
        CONSTRAINT ck_lending_contracts_signature_by_status CHECK (
          (status <> 'draft' OR envelope_id IS NULL)
          AND (status NOT IN ('sent_for_signature', 'signed', 'active', 'completed', 'defaulted')
               OR envelope_id IS NOT NULL)
          AND ((status IN ('signed', 'active', 'completed', 'defaulted')) = (signed_at IS NOT NULL))
          AND ((status IN ('active', 'completed', 'defaulted')) = (activated_on IS NOT NULL))
          AND ((status = 'cancelled') = (cancellation_reason IS NOT NULL))
        )
      )
    `);
    // One contract per accepted offer.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_lending_contracts_application_id
        ON lending.contracts (application_id)
    `);
    // Signature callbacks find their contract by envelope.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_lending_contracts_envelope_id
        ON lending.contracts (envelope_id)
        WHERE envelope_id IS NOT NULL
    `);
    // A student's contracts, a center's portfolio and everyone's (staff), newest first.
    await queryRunner.query(`
      CREATE INDEX ix_lending_contracts_student_id_created_at_id
        ON lending.contracts (student_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_lending_contracts_center_id_created_at_id
        ON lending.contracts (center_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_lending_contracts_status_created_at_id
        ON lending.contracts (status, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_lending_contracts_created_at_id
        ON lending.contracts (created_at DESC, id DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE lending.contracts`);
  }
}
