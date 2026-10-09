import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class AddIamRefreshTokenFamilyExpiry1791586800000 implements MigrationInterface {
  name = 'AddIamRefreshTokenFamilyExpiry1791586800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE iam.refresh_tokens ADD COLUMN family_expires_at timestamptz(3) NULL`,
    );
    // Sessions that already exist end 90 days after their oldest token, the default maximum.
    await queryRunner.query(`
      UPDATE iam.refresh_tokens AS token
         SET family_expires_at = family.started_at + interval '90 days'
        FROM (
          SELECT family_id, min(issued_at) AS started_at FROM iam.refresh_tokens GROUP BY family_id
        ) AS family
       WHERE family.family_id = token.family_id
    `);
    await queryRunner.query(
      `ALTER TABLE iam.refresh_tokens ALTER COLUMN family_expires_at SET NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE iam.refresh_tokens
        ADD CONSTRAINT ck_iam_refresh_tokens_within_family CHECK (expires_at <= family_expires_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE iam.refresh_tokens DROP CONSTRAINT ck_iam_refresh_tokens_within_family`,
    );
    await queryRunner.query(`ALTER TABLE iam.refresh_tokens DROP COLUMN family_expires_at`);
  }
}
