import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The daily sweep deletes tokens whose session ended long ago, oldest first. A plain CREATE INDEX:
// CONCURRENTLY would wait on the snapshot of a replica blocked on the startup migration lock
// (runMigrationsExclusively, ADR 013) and deadlock with it; the table is small enough today for
// the brief write lock. Built on a large table, it would run by hand before the release.
export class AddRefreshTokensFamilyExpiryIndex1791868140000 implements MigrationInterface {
  name = 'AddRefreshTokensFamilyExpiryIndex1791868140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX ix_iam_refresh_tokens_family_expires_at ON iam.refresh_tokens (family_expires_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX iam.ix_iam_refresh_tokens_family_expires_at`);
  }
}
