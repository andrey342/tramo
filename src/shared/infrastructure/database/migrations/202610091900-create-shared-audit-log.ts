import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateSharedAuditLog1791572400000 implements MigrationInterface {
  name = 'CreateSharedAuditLog1791572400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS shared`);
    await queryRunner.query(`
      CREATE TABLE shared.audit_log (
        id uuid PRIMARY KEY,
        occurred_at timestamptz NOT NULL,
        actor_type text NOT NULL
          CONSTRAINT ck_shared_audit_log_actor_type CHECK (actor_type IN ('user', 'api_key', 'anonymous')),
        actor_id text NULL,
        action text NOT NULL,
        resource_type text NOT NULL,
        resource_id text NULL,
        outcome text NOT NULL
          CONSTRAINT ck_shared_audit_log_outcome CHECK (outcome IN ('succeeded', 'failed')),
        error_code text NULL,
        request_id text NULL,
        changes jsonb NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb
      )
    `);
    await queryRunner.query(`
      CREATE INDEX ix_shared_audit_log_resource
        ON shared.audit_log (resource_type, resource_id, occurred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_shared_audit_log_actor
        ON shared.audit_log (actor_type, actor_id, occurred_at DESC)
    `);
    await queryRunner.query(`
      CREATE INDEX ix_shared_audit_log_request_id ON shared.audit_log (request_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE shared.audit_log`);
  }
}
