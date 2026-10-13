import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The monthly billing run walks the active plans in contract order; completed plans,
// which outgrow them with time, are left out of the index.
export class AddFinancingPlansActiveIndex1791856140000 implements MigrationInterface {
  name = 'AddFinancingPlansActiveIndex1791856140000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX ix_lending_financing_plans_active_contract_id
        ON lending.financing_plans (contract_id) WHERE status = 'active'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX lending.ix_lending_financing_plans_active_contract_id`);
  }
}
