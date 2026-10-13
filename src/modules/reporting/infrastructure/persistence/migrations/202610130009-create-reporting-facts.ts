import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The read models of reporting: one fact per application, contract, disbursement and charge,
// built up from the events of the other modules (their ids, no foreign keys: ADR 008). Columns
// an event may not carry are nullable; the status follows the latest event (last_event_at, then
// last_event_id). Disposable: a rebuild deletes and replays them (ADR 019).
export class CreateReportingFacts1791850140000 implements MigrationInterface {
  name = 'CreateReportingFacts1791850140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE reporting.application_facts (
        application_id uuid NOT NULL,
        center_id uuid NULL,
        program_id uuid NULL,
        product text NULL CONSTRAINT ck_reporting_application_facts_product
          CHECK (product IN ('installments', 'isa')),
        amount_cents bigint NULL CONSTRAINT ck_reporting_application_facts_amount_cents
          CHECK (amount_cents >= 0),
        status text NULL CONSTRAINT ck_reporting_application_facts_status
          CHECK (status IN ('submitted', 'approved', 'needs_review', 'rejected', 'offer_accepted', 'cancelled', 'expired')),
        decision text NULL CONSTRAINT ck_reporting_application_facts_decision
          CHECK (decision IN ('approved', 'rejected')),
        last_event_at timestamptz(3) NOT NULL,
        last_event_id uuid NOT NULL,
        CONSTRAINT pk_reporting_application_facts PRIMARY KEY (application_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_application_facts_center_id
        ON reporting.application_facts (center_id)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_application_facts_program_id
        ON reporting.application_facts (program_id)
    `);
    await queryRunner.query(`
      CREATE TABLE reporting.contract_facts (
        contract_id uuid NOT NULL,
        center_id uuid NULL,
        product text NULL CONSTRAINT ck_reporting_contract_facts_product
          CHECK (product IN ('installments', 'isa')),
        principal_cents bigint NULL CONSTRAINT ck_reporting_contract_facts_principal_cents
          CHECK (principal_cents >= 0),
        status text NULL CONSTRAINT ck_reporting_contract_facts_status
          CHECK (status IN ('active', 'in_arrears', 'completed', 'defaulted', 'cancelled')),
        last_event_at timestamptz(3) NOT NULL,
        last_event_id uuid NOT NULL,
        CONSTRAINT pk_reporting_contract_facts PRIMARY KEY (contract_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_contract_facts_center_id
        ON reporting.contract_facts (center_id)
    `);
    await queryRunner.query(`
      CREATE TABLE reporting.disbursement_facts (
        disbursement_id uuid NOT NULL,
        contract_id uuid NULL,
        center_id uuid NULL,
        amount_cents bigint NULL CONSTRAINT ck_reporting_disbursement_facts_amount_cents
          CHECK (amount_cents >= 0),
        status text NULL CONSTRAINT ck_reporting_disbursement_facts_status
          CHECK (status IN ('pending', 'sent', 'settled', 'failed')),
        last_event_at timestamptz(3) NOT NULL,
        last_event_id uuid NOT NULL,
        CONSTRAINT pk_reporting_disbursement_facts PRIMARY KEY (disbursement_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_disbursement_facts_center_id
        ON reporting.disbursement_facts (center_id)
    `);
    await queryRunner.query(`
      CREATE TABLE reporting.charge_facts (
        charge_id uuid NOT NULL,
        contract_id uuid NULL,
        center_id uuid NULL,
        kind text NULL CONSTRAINT ck_reporting_charge_facts_kind
          CHECK (kind IN ('installment', 'isa', 'payoff')),
        amount_cents bigint NULL CONSTRAINT ck_reporting_charge_facts_amount_cents
          CHECK (amount_cents >= 0),
        status text NULL CONSTRAINT ck_reporting_charge_facts_status
          CHECK (status IN ('scheduled', 'paid', 'failed', 'overdue', 'written_off', 'cancelled')),
        failed_on date NULL,
        last_event_at timestamptz(3) NOT NULL,
        last_event_id uuid NOT NULL,
        CONSTRAINT pk_reporting_charge_facts PRIMARY KEY (charge_id)
      )
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_charge_facts_center_id
        ON reporting.charge_facts (center_id)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_charge_facts_contract_id
        ON reporting.charge_facts (contract_id)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_reporting_charge_facts_failed_on
        ON reporting.charge_facts (failed_on)
        WHERE failed_on IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE reporting.charge_facts`);
    await queryRunner.query(`DROP TABLE reporting.disbursement_facts`);
    await queryRunner.query(`DROP TABLE reporting.contract_facts`);
    await queryRunner.query(`DROP TABLE reporting.application_facts`);
  }
}
