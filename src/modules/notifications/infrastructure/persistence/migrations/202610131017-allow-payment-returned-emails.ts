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
];

// The email telling a student that the bank returned a debit already collected (billing's
// ChargeReturned).
export class AllowPaymentReturnedEmails1791886620000 implements MigrationInterface {
  name = 'AllowPaymentReturnedEmails1791886620000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...TEMPLATES, 'payment_returned']);
  }

  // The template no longer exists: its emails, sent or not, go with it.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM notifications.notification_log WHERE template = 'payment_returned'`,
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
