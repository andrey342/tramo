import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateBillingDeclarationReminders1791836160000 implements MigrationInterface {
  name = 'CreateBillingDeclarationReminders1791836160000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // One reminder per contract and month, whatever the runs of the job.
    await queryRunner.query(`
      CREATE TABLE billing.declaration_reminders (
        -- lending's contract (ADR 008).
        contract_id uuid NOT NULL,
        period text NOT NULL CONSTRAINT ck_billing_declaration_reminders_period
          CHECK (period ~ '^\\d{4}-(0[1-9]|1[0-2])$'),
        sent_at timestamptz(3) NOT NULL,
        CONSTRAINT pk_billing_declaration_reminders PRIMARY KEY (contract_id, period)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE billing.declaration_reminders`);
  }
}
