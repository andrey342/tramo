import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateIamApiKeys1791583200000 implements MigrationInterface {
  name = 'CreateIamApiKeys1791583200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // center_id references catalog.training_centers, which lives in another schema: no foreign
    // key across modules (ADR 008).
    await queryRunner.query(`
      CREATE TABLE iam.api_keys (
        id uuid PRIMARY KEY,
        center_id uuid NOT NULL,
        name text NOT NULL CONSTRAINT ck_iam_api_keys_name CHECK (length(name) BETWEEN 1 AND 100),
        prefix text NOT NULL CONSTRAINT ck_iam_api_keys_prefix CHECK (prefix ~ '^[0-9a-f]{8}$'),
        secret_hash text NOT NULL,
        scopes text[] NOT NULL
          CONSTRAINT ck_iam_api_keys_scopes CHECK (
            cardinality(scopes) > 0
            AND scopes <@ ARRAY[
              'applications:read', 'applications:write', 'programs:read', 'programs:write',
              'portfolio:read'
            ]::text[]
          ),
        created_by uuid NOT NULL CONSTRAINT fk_iam_api_keys_created_by REFERENCES iam.users (id),
        created_at timestamptz(3) NOT NULL,
        last_used_at timestamptz(3) NULL,
        revoked_at timestamptz(3) NULL,
        version integer NOT NULL CONSTRAINT ck_iam_api_keys_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX ux_iam_api_keys_prefix ON iam.api_keys (prefix)`);
    await queryRunner.query(
      `CREATE INDEX ix_iam_api_keys_center_id_created_at ON iam.api_keys (center_id, created_at)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE iam.api_keys`);
  }
}
