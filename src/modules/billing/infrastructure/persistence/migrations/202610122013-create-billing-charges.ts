import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateBillingCharges1791835980000 implements MigrationInterface {
  name = 'CreateBillingCharges1791835980000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE billing.charges (
        id uuid NOT NULL,
        -- lending's contract, iam's student and catalog's center (ADR 008).
        contract_id uuid NOT NULL,
        student_id uuid NOT NULL,
        center_id uuid NOT NULL,
        kind text NOT NULL CONSTRAINT ck_billing_charges_kind
          CHECK (kind IN ('installment', 'isa', 'payoff')),
        reference text NOT NULL,
        installment_number integer NULL CONSTRAINT ck_billing_charges_installment_number
          CHECK (installment_number > 0),
        period text NOT NULL CONSTRAINT ck_billing_charges_period
          CHECK (period ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
        amount_cents integer NOT NULL CONSTRAINT ck_billing_charges_amount_cents
          CHECK (amount_cents > 0),
        due_date date NOT NULL,
        status text NOT NULL CONSTRAINT ck_billing_charges_status
          CHECK (status IN ('scheduled', 'pending', 'paid', 'failed', 'overdue', 'written_off',
                            'cancelled')),
        -- Collection attempts, read back whole with the charge.
        attempts jsonb NOT NULL CONSTRAINT ck_billing_charges_attempts
          CHECK (jsonb_typeof(attempts) = 'array'),
        dunning_step integer NOT NULL CONSTRAINT ck_billing_charges_dunning_step
          CHECK (dunning_step >= 0),
        paid_at timestamptz(3) NULL,
        status_changed_at timestamptz(3) NOT NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_billing_charges_version CHECK (version > 0),
        CONSTRAINT pk_billing_charges PRIMARY KEY (id),
        -- Mirrors the domain: an instalment says which one; only a paid charge has a payment
        -- time; a charge in collection or settled by the provider had an attempt.
        CONSTRAINT ck_billing_charges_state CHECK (
          ((kind = 'installment') = (installment_number IS NOT NULL))
          AND ((status = 'paid') = (paid_at IS NOT NULL))
          AND (status NOT IN ('pending', 'paid') OR jsonb_array_length(attempts) > 0)
        )
      )
    `);
    // One charge per contract and what it is for: a second billing run creates nothing.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_billing_charges_contract_id_reference
        ON billing.charges (contract_id, reference)
    `);
    // A contract's charges, newest first.
    await queryRunner.query(`
      CREATE INDEX ix_billing_charges_contract_id_created_at_id
        ON billing.charges (contract_id, created_at DESC, id DESC)
    `);
    // Collection: scheduled charges by due date.
    await queryRunner.query(`
      CREATE INDEX ix_billing_charges_scheduled_due_date
        ON billing.charges (due_date, id)
        WHERE status = 'scheduled'
    `);
    // Dunning walks the charges not settled, by id.
    await queryRunner.query(`
      CREATE INDEX ix_billing_charges_unsettled
        ON billing.charges (id)
        WHERE status NOT IN ('paid', 'written_off', 'cancelled')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE billing.charges`);
  }
}
