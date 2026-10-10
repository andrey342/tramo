import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class RenameIamPrimaryKeys1791661440000 implements MigrationInterface {
  name = 'RenameIamPrimaryKeys1791661440000';

  // The tables were created with inline PRIMARY KEY, which Postgres names <table>_pkey.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE iam.users RENAME CONSTRAINT users_pkey TO pk_iam_users`);
    await queryRunner.query(
      `ALTER TABLE iam.refresh_tokens RENAME CONSTRAINT refresh_tokens_pkey TO pk_iam_refresh_tokens`,
    );
    await queryRunner.query(
      `ALTER TABLE iam.api_keys RENAME CONSTRAINT api_keys_pkey TO pk_iam_api_keys`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE iam.api_keys RENAME CONSTRAINT pk_iam_api_keys TO api_keys_pkey`,
    );
    await queryRunner.query(
      `ALTER TABLE iam.refresh_tokens RENAME CONSTRAINT pk_iam_refresh_tokens TO refresh_tokens_pkey`,
    );
    await queryRunner.query(`ALTER TABLE iam.users RENAME CONSTRAINT pk_iam_users TO users_pkey`);
  }
}
