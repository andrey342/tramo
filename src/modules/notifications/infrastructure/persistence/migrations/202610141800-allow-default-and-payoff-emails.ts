import { type MigrationInterface, type QueryRunner } from 'typeorm';

const TEMPLATES = [
  'welcome',
  'application_received',
  'application_decided',
  'contract_ready_to_sign',
  'disbursement_settled',
  'installment_reminder',
  'installment_collected',
  'payment_overdue',
  'contract_in_arrears',
  'isa_declaration_reminder',
  'isa_declaration_overdue',
  'payment_returned',
];
const ADDED = ['contract_defaulted', 'payoff_withdrawn'];

// The emails telling a student that the contract defaulted (lending's ContractDefaulted) and that
// a payoff could not be collected (PayoffWithdrawn).
export class AllowDefaultAndPayoffEmails1792000800000 implements MigrationInterface {
  name = 'AllowDefaultAndPayoffEmails1792000800000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...TEMPLATES, ...ADDED]);
  }

  // The templates no longer exist: their emails, sent or not, go with them.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM notifications.notification_log WHERE template IN ('contract_defaulted', 'payoff_withdrawn')`,
    );
    await this.replace(queryRunner, TEMPLATES);
  }

  private async replace(queryRunner: QueryRunner, templates: readonly string[]): Promise<void> {
    const list = templates.map((template) => `'${template}'`).join(', ');
    await queryRunner.query(`
      ALTER TABLE notifications.notification_log
        DROP CONSTRAINT ck_notifications_notification_log_template,
        ADD CONSTRAINT ck_notifications_notification_log_template
          CHECK (template IN (${list}))
    `);
  }
}
