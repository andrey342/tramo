import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateLendingDisbursements1791829020000 implements MigrationInterface {
  name = 'CreateLendingDisbursements1791829020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE lending.disbursements (
        id uuid NOT NULL,
        contract_id uuid NOT NULL,
        -- catalog's center (ADR 008).
        center_id uuid NOT NULL,
        amount_cents integer NOT NULL
          CONSTRAINT ck_lending_disbursements_amount_cents CHECK (amount_cents > 0),
        attempt integer NOT NULL CONSTRAINT ck_lending_disbursements_attempt CHECK (attempt > 0),
        transfer_id text NULL,
        failure_reason text NULL CONSTRAINT ck_lending_disbursements_failure_reason
          CHECK (length(failure_reason) BETWEEN 1 AND 200),
        status text NOT NULL CONSTRAINT ck_lending_disbursements_status
          CHECK (status IN ('pending', 'sent', 'settled', 'failed')),
        status_changed_at timestamptz(3) NOT NULL,
        settled_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_lending_disbursements_version CHECK (version > 0),
        CONSTRAINT pk_lending_disbursements PRIMARY KEY (id),
        CONSTRAINT fk_lending_disbursements_contract_id FOREIGN KEY (contract_id)
          REFERENCES lending.contracts (id),
        -- Mirrors the domain: a sent or settled transfer has the bank's id, only a settled one a
        -- settlement time, only a failed one a reason.
        CONSTRAINT ck_lending_disbursements_state CHECK (
          (status NOT IN ('sent', 'settled') OR transfer_id IS NOT NULL)
          AND ((status = 'settled') = (settled_at IS NOT NULL))
          AND ((status = 'failed') = (failure_reason IS NOT NULL))
        )
      )
    `);
    // One disbursement per contract; also the index of the foreign key.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_lending_disbursements_contract_id
        ON lending.disbursements (contract_id)
    `);
    // Ops' list, by status or all, newest first.
    await queryRunner.query(`
      CREATE INDEX ix_lending_disbursements_status_created_at_id
        ON lending.disbursements (status, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_lending_disbursements_created_at_id
        ON lending.disbursements (created_at DESC, id DESC)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE lending.disbursements`);
  }
}
