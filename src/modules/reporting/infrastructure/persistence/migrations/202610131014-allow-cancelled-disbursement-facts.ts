import { type MigrationInterface, type QueryRunner } from 'typeorm';

// A transfer that failed for good is cancelled with its contract (lending); the fact follows, so
// operations stop counting it among the failed disbursements to deal with.
export class AllowCancelledDisbursementFacts1791886440000 implements MigrationInterface {
  name = 'AllowCancelledDisbursementFacts1791886440000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE reporting.disbursement_facts
        DROP CONSTRAINT ck_reporting_disbursement_facts_status,
        ADD CONSTRAINT ck_reporting_disbursement_facts_status
          CHECK (status IN ('pending', 'sent', 'settled', 'failed', 'cancelled'))
    `);
  }

  // A cancelled transfer had failed before; the facts are disposable and a rebuild restores them.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE reporting.disbursement_facts SET status = 'failed' WHERE status = 'cancelled'`,
    );
    await queryRunner.query(`
      ALTER TABLE reporting.disbursement_facts
        DROP CONSTRAINT ck_reporting_disbursement_facts_status,
        ADD CONSTRAINT ck_reporting_disbursement_facts_status
          CHECK (status IN ('pending', 'sent', 'settled', 'failed'))
    `);
  }
}
