import { type MigrationInterface, type QueryRunner } from 'typeorm';

// api_keys.created_by references iam.users: deleting or checking a user would otherwise scan the
// keys.
export class AddApiKeysCreatedByIndex1791856200000 implements MigrationInterface {
  name = 'AddApiKeysCreatedByIndex1791856200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX ix_iam_api_keys_created_by ON iam.api_keys (created_by)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX iam.ix_iam_api_keys_created_by`);
  }
}
