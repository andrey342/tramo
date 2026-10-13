import { type MigrationInterface, type QueryRunner } from 'typeorm';

// An API key may be issued with an end date; null keeps the keys issued so far (and those issued
// without one) valid until revoked. A nullable column without a default changes no row.
export class AddApiKeysExpiresAt1791883740000 implements MigrationInterface {
  name = 'AddApiKeysExpiresAt1791883740000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE iam.api_keys ADD COLUMN expires_at timestamptz(3) NULL`);
    await queryRunner.query(`
      ALTER TABLE iam.api_keys ADD CONSTRAINT ck_iam_api_keys_expires_at
        CHECK (expires_at IS NULL OR expires_at > created_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE iam.api_keys DROP CONSTRAINT ck_iam_api_keys_expires_at`);
    await queryRunner.query(`ALTER TABLE iam.api_keys DROP COLUMN expires_at`);
  }
}
