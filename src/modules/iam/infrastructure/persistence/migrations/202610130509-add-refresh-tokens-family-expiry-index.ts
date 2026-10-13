import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The daily sweep deletes tokens whose session ended long ago, oldest first. Nothing pruned the
// table until now, so the index is built without blocking sign-ins and refreshes.
export class AddRefreshTokensFamilyExpiryIndex1791868140000 implements MigrationInterface {
  name = 'AddRefreshTokensFamilyExpiryIndex1791868140000';
  transaction = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX CONCURRENTLY ix_iam_refresh_tokens_family_expires_at
         ON iam.refresh_tokens (family_expires_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX CONCURRENTLY iam.ix_iam_refresh_tokens_family_expires_at`);
  }
}
