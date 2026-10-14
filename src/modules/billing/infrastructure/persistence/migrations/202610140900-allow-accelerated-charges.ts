import { type MigrationInterface, type QueryRunner } from 'typeorm';

const KINDS = ['installment', 'isa', 'payoff'];

// A defaulted loan's principal left to bill is raised as one charge (`accelerated`) and written
// off at once.
export class AllowAcceleratedCharges1791968400000 implements MigrationInterface {
  name = 'AllowAcceleratedCharges1791968400000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...KINDS, 'accelerated']);
  }

  // Refused while such a charge exists: it is a written off debt, not something to drop.
  async down(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, KINDS);
  }

  private async replace(queryRunner: QueryRunner, kinds: readonly string[]): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE billing.charges
        DROP CONSTRAINT ck_billing_charges_kind,
        ADD CONSTRAINT ck_billing_charges_kind
          CHECK (kind IN (${kinds.map((kind) => `'${kind}'`).join(', ')}))
    `);
  }
}
