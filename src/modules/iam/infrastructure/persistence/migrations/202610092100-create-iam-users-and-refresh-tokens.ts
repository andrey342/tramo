import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateIamUsersAndRefreshTokens1791579600000 implements MigrationInterface {
  name = 'CreateIamUsersAndRefreshTokens1791579600000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS iam`);

    await queryRunner.query(`
      CREATE TABLE iam.users (
        id uuid PRIMARY KEY,
        email text NOT NULL,
        password_hash text NOT NULL,
        roles text[] NOT NULL
          CONSTRAINT ck_iam_users_roles CHECK (
            cardinality(roles) > 0
            AND roles <@ ARRAY['student', 'center_admin', 'ops', 'admin']::text[]
          ),
        center_id uuid NULL,
        status text NOT NULL
          CONSTRAINT ck_iam_users_status CHECK (status IN ('active', 'disabled')),
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_iam_users_version CHECK (version > 0),
        -- Center users belong to a center; nobody else does (mirrors the User invariant).
        CONSTRAINT ck_iam_users_center CHECK (
          (center_id IS NOT NULL) = ('center_admin' = ANY(roles))
        )
      )
    `);
    // Emails are normalised to lower case by the domain before they get here.
    await queryRunner.query(`CREATE UNIQUE INDEX ux_iam_users_email ON iam.users (email)`);
    await queryRunner.query(
      `CREATE INDEX ix_iam_users_center_id ON iam.users (center_id) WHERE center_id IS NOT NULL`,
    );

    await queryRunner.query(`
      CREATE TABLE iam.refresh_tokens (
        id uuid PRIMARY KEY,
        family_id uuid NOT NULL,
        user_id uuid NOT NULL CONSTRAINT fk_iam_refresh_tokens_user REFERENCES iam.users (id),
        token_hash text NOT NULL,
        status text NOT NULL
          CONSTRAINT ck_iam_refresh_tokens_status CHECK (status IN ('active', 'rotated', 'revoked')),
        issued_at timestamptz(3) NOT NULL,
        expires_at timestamptz(3) NOT NULL,
        used_at timestamptz(3) NULL,
        version integer NOT NULL CONSTRAINT ck_iam_refresh_tokens_version CHECK (version > 0)
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX ux_iam_refresh_tokens_token_hash ON iam.refresh_tokens (token_hash)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_iam_refresh_tokens_family_id ON iam.refresh_tokens (family_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX ix_iam_refresh_tokens_user_id ON iam.refresh_tokens (user_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE iam.refresh_tokens`);
    await queryRunner.query(`DROP TABLE iam.users`);
  }
}
