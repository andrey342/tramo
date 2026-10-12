import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateBillingLedgerEntries1791836100000 implements MigrationInterface {
  name = 'CreateBillingLedgerEntries1791836100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // A projection of charge events, append only: no version.
    await queryRunner.query(`
      CREATE TABLE billing.ledger_entries (
        id uuid NOT NULL,
        -- The outbox event the line comes from: one line per event.
        event_id uuid NOT NULL,
        -- lending's contract (ADR 008).
        contract_id uuid NOT NULL,
        charge_id uuid NOT NULL,
        type text NOT NULL CONSTRAINT ck_billing_ledger_entries_type
          CHECK (type IN ('charge', 'payment', 'write_off', 'cancellation')),
        -- Positive owed by the student, negative paid or no longer owed.
        amount_cents integer NOT NULL CONSTRAINT ck_billing_ledger_entries_amount_cents
          CHECK ((type = 'charge') = (amount_cents > 0) AND amount_cents <> 0),
        description text NOT NULL,
        occurred_at timestamptz(3) NOT NULL,
        CONSTRAINT pk_billing_ledger_entries PRIMARY KEY (id),
        CONSTRAINT fk_billing_ledger_entries_charge_id FOREIGN KEY (charge_id)
          REFERENCES billing.charges (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_billing_ledger_entries_event_id
        ON billing.ledger_entries (event_id)
    `);
    // A contract's statement, in order.
    await queryRunner.query(`
      CREATE INDEX ix_billing_ledger_entries_contract_id_occurred_at_id
        ON billing.ledger_entries (contract_id, occurred_at, id)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_billing_ledger_entries_charge_id
        ON billing.ledger_entries (charge_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE billing.ledger_entries`);
  }
}
