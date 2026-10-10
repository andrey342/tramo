import { type MigrationInterface, type QueryRunner } from 'typeorm';

// An active center whose VAT number the registry stops recognising stays active until ops decide
// (TrainingCenter.recordVatCheck); the old CHECK made that check result impossible to save. A
// center still becomes active only through a valid result, which the domain enforces.
export class AllowInvalidVatOnActiveCenters1791672300000 implements MigrationInterface {
  name = 'AllowInvalidVatOnActiveCenters1791672300000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE catalog.training_centers DROP CONSTRAINT ck_catalog_training_centers_active_is_valid`,
    );
    await queryRunner.query(`
      ALTER TABLE catalog.training_centers ADD CONSTRAINT ck_catalog_training_centers_active_is_valid
        CHECK (status <> 'active' OR vat_status IN ('valid', 'invalid'))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE catalog.training_centers DROP CONSTRAINT ck_catalog_training_centers_active_is_valid`,
    );
    await queryRunner.query(`
      ALTER TABLE catalog.training_centers ADD CONSTRAINT ck_catalog_training_centers_active_is_valid
        CHECK (status <> 'active' OR vat_status = 'valid')
    `);
  }
}
