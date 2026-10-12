import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateLendingSchema1791825780000 implements MigrationInterface {
  name = 'CreateLendingSchema1791825780000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS lending`);
  }

  // The schema may predate this migration (docker/postgres/init.sql creates it, with the grants
  // of the read-only role), so reverting leaves it in place, as iam's migrations do.
  async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to undo.
  }
}
