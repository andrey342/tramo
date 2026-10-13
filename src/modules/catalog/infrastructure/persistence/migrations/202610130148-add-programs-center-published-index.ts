import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The catalog of one center (GET /programs?centerId=): its published programs, newest first,
// without sorting all of them.
export class AddProgramsCenterPublishedIndex1791856080000 implements MigrationInterface {
  name = 'AddProgramsCenterPublishedIndex1791856080000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX ix_catalog_programs_center_id_created_at_id
        ON catalog.programs (center_id, created_at DESC, id DESC) WHERE status = 'published'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX catalog.ix_catalog_programs_center_id_created_at_id`);
  }
}
