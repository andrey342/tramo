import { type MigrationInterface, type QueryRunner } from 'typeorm';

const BEFORE = `'draft', 'submitted', 'verifying', 'scoring', 'approved', 'needs_review', 'rejected',
  'offer_accepted', 'cancelled', 'expired'`;
const AFTER = `${BEFORE}, 'withdrawn', 'closed'`;

// An accepted offer follows the contract lending drew from it: `withdrawn` when the contract was
// cancelled before taking effect, `closed` when it ran its course. Both are final, decided and
// free the program, so the student may apply for it again; `offer_accepted` still holds it.
export class AddFinancingApplicationsEndedStatuses1791867480000 implements MigrationInterface {
  name = 'AddFinancingApplicationsEndedStatuses1791867480000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, {
      statuses: AFTER,
      decided: `'approved', 'needs_review', 'rejected', 'offer_accepted', 'withdrawn', 'closed'`,
      notExpiring: `'rejected', 'offer_accepted', 'cancelled', 'expired', 'withdrawn', 'closed',
                    'needs_review'`,
      open: `'rejected', 'cancelled', 'expired', 'withdrawn', 'closed'`,
    });
  }

  // Neither status exists before this migration. Cancelled is the final state that, like them,
  // leaves the program free: an application filed again for it stays valid.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE origination.financing_applications SET status = 'cancelled'
        WHERE status IN ('withdrawn', 'closed')
    `);
    await this.replace(queryRunner, {
      statuses: BEFORE,
      decided: `'approved', 'needs_review', 'rejected', 'offer_accepted'`,
      notExpiring: `'rejected', 'offer_accepted', 'cancelled', 'expired', 'needs_review'`,
      open: `'rejected', 'cancelled', 'expired'`,
    });
  }

  private async replace(
    queryRunner: QueryRunner,
    lists: { statuses: string; decided: string; notExpiring: string; open: string },
  ): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE origination.financing_applications
        DROP CONSTRAINT ck_origination_financing_applications_status,
        DROP CONSTRAINT ck_origination_financing_applications_decided
    `);
    await queryRunner.query(`
      ALTER TABLE origination.financing_applications
        ADD CONSTRAINT ck_origination_financing_applications_status
          CHECK (status IN (${lists.statuses})),
        ADD CONSTRAINT ck_origination_financing_applications_decided CHECK (
          status NOT IN (${lists.decided})
          OR (decision IS NOT NULL AND score IS NOT NULL)
        )
    `);
    await queryRunner.query(`
      DROP INDEX origination.ix_origination_financing_applications_expiring_last_activity_at
    `);
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_expiring_last_activity_at
        ON origination.financing_applications (last_activity_at, id)
        WHERE status NOT IN (${lists.notExpiring})
    `);
    await queryRunner.query(`
      DROP INDEX origination.ux_origination_financing_applications_open_per_program
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_origination_financing_applications_open_per_program
        ON origination.financing_applications (applicant_id, program_id)
        WHERE status NOT IN (${lists.open})
    `);
  }
}
