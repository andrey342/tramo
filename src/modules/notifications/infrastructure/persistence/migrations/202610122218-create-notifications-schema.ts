import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateNotificationsSchema1791843480000 implements MigrationInterface {
  name = 'CreateNotificationsSchema1791843480000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS notifications`);
  }

  // The schema may predate this migration (docker/postgres/init.sql creates it, with the grants
  // of the read-only role), so reverting leaves it in place, as iam's migrations do.
  async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to undo.
  }
}
