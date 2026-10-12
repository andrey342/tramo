import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateBillingIncomeDeclarations1791836040000 implements MigrationInterface {
  name = 'CreateBillingIncomeDeclarations1791836040000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE billing.income_declarations (
        id uuid NOT NULL,
        -- lending's contract and iam's student (ADR 008).
        contract_id uuid NOT NULL,
        student_id uuid NOT NULL,
        period text NOT NULL CONSTRAINT ck_billing_income_declarations_period
          CHECK (period ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
        gross_monthly_income_cents integer NOT NULL
          CONSTRAINT ck_billing_income_declarations_gross_monthly_income_cents
          CHECK (gross_monthly_income_cents >= 0),
        source text NOT NULL CONSTRAINT ck_billing_income_declarations_source
          CHECK (source IN ('self', 'employment_provider')),
        declared_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_billing_income_declarations_version
          CHECK (version > 0),
        CONSTRAINT pk_billing_income_declarations PRIMARY KEY (id)
      )
    `);
    // One declaration per contract and month; also how the cycle finds it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_billing_income_declarations_contract_id_period
        ON billing.income_declarations (contract_id, period)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE billing.income_declarations`);
  }
}
