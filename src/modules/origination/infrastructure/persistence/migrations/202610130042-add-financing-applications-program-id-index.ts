import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The mean score of a program (GetProgramScoresQuery) reads only its scored applications.
export class AddFinancingApplicationsProgramIdIndex1791852120000 implements MigrationInterface {
  name = 'AddFinancingApplicationsProgramIdIndex1791852120000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX ix_origination_financing_applications_program_id_score
        ON origination.financing_applications (program_id, score)
        WHERE score IS NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX origination.ix_origination_financing_applications_program_id_score`,
    );
  }
}
