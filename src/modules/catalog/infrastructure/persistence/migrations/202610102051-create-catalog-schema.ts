import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateCatalogSchema1791665460000 implements MigrationInterface {
  name = 'CreateCatalogSchema1791665460000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS catalog`);
  }

  // Without CASCADE: reverting fails loudly if a later migration left tables behind.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP SCHEMA IF EXISTS catalog`);
  }
}
