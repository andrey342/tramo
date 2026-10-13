import { type MigrationInterface, type QueryRunner } from 'typeorm';

const REASONS = ['repaid', 'paid_off', 'cap_reached', 'max_payments', 'window_expired'];

// A contract that defaults closes its plan, with a reason of its own, so nothing more is billed
// and the schedule no longer shows it active.
export class AllowDefaultedPlanCompletion1791867900000 implements MigrationInterface {
  name = 'AllowDefaultedPlanCompletion1791867900000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...REASONS, 'defaulted']);
  }

  // Before this, the plan of a defaulted contract stayed active: those closed are opened again.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE lending.financing_plans
        SET status = 'active', completion_reason = NULL, completed_at = NULL
        WHERE completion_reason = 'defaulted'
    `);
    await this.replace(queryRunner, REASONS);
  }

  private async replace(queryRunner: QueryRunner, reasons: readonly string[]): Promise<void> {
    const list = reasons.map((reason) => `'${reason}'`).join(', ');
    await queryRunner.query(`
      ALTER TABLE lending.financing_plans
        DROP CONSTRAINT ck_lending_financing_plans_completion_reason,
        ADD CONSTRAINT ck_lending_financing_plans_completion_reason
          CHECK (completion_reason IN (${list}))
    `);
  }
}
