import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateBillingPaymentMandates1791835860000 implements MigrationInterface {
  name = 'CreateBillingPaymentMandates1791835860000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE billing.payment_mandates (
        id uuid NOT NULL,
        -- lending's contract and iam's student: other schemas, so not foreign keys (ADR 008).
        contract_id uuid NOT NULL,
        student_id uuid NOT NULL,
        -- Encrypted, bound to the row (ADR 014).
        iban_encrypted text NOT NULL,
        reference text NOT NULL CONSTRAINT ck_billing_payment_mandates_reference
          CHECK (reference ~ '^TRAMO-[0-9A-F]{16}$'),
        status text NOT NULL CONSTRAINT ck_billing_payment_mandates_status
          CHECK (status IN ('active', 'revoked')),
        signed_at timestamptz(3) NOT NULL,
        revoked_at timestamptz(3) NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_billing_payment_mandates_version CHECK (version > 0),
        CONSTRAINT pk_billing_payment_mandates PRIMARY KEY (id),
        CONSTRAINT ck_billing_payment_mandates_revoked CHECK (
          (status = 'revoked') = (revoked_at IS NOT NULL)
        )
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_billing_payment_mandates_reference
        ON billing.payment_mandates (reference)
    `);
    // One mandate in force per contract; also how collection finds it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_billing_payment_mandates_active_contract_id
        ON billing.payment_mandates (contract_id)
        WHERE status = 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE billing.payment_mandates`);
  }
}
