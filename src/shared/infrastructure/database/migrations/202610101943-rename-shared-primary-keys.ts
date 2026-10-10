import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class RenameSharedPrimaryKeys1791661380000 implements MigrationInterface {
  name = 'RenameSharedPrimaryKeys1791661380000';

  // The tables were created with inline PRIMARY KEY, which Postgres names <table>_pkey.
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE shared.outbox_messages RENAME CONSTRAINT outbox_messages_pkey TO pk_shared_outbox_messages`,
    );
    await queryRunner.query(
      `ALTER TABLE shared.audit_log RENAME CONSTRAINT audit_log_pkey TO pk_shared_audit_log`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE shared.audit_log RENAME CONSTRAINT pk_shared_audit_log TO audit_log_pkey`,
    );
    await queryRunner.query(
      `ALTER TABLE shared.outbox_messages RENAME CONSTRAINT pk_shared_outbox_messages TO outbox_messages_pkey`,
    );
  }
}
