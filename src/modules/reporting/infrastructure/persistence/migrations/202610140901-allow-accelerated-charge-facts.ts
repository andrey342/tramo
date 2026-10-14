import { type MigrationInterface, type QueryRunner } from 'typeorm';

const KINDS = ['installment', 'isa', 'payoff'];

// Billing raises a defaulted loan's principal left to bill as an `accelerated` charge, written off
// at once; its fact counts it among the losses.
export class AllowAcceleratedChargeFacts1791968460000 implements MigrationInterface {
  name = 'AllowAcceleratedChargeFacts1791968460000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...KINDS, 'accelerated']);
  }

  // The facts are disposable and a rebuild restores them.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM reporting.charge_facts WHERE kind = 'accelerated'`);
    await this.replace(queryRunner, KINDS);
  }

  private async replace(queryRunner: QueryRunner, kinds: readonly string[]): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE reporting.charge_facts
        DROP CONSTRAINT ck_reporting_charge_facts_kind,
        ADD CONSTRAINT ck_reporting_charge_facts_kind
          CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(', ')}))
    `);
  }
}
