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
];

// The email telling an ISA student that two months in a row went undeclared
// (lending's IsaDeclarationOverdue).
export class AllowIsaDeclarationOverdueEmails1791868500000 implements MigrationInterface {
  name = 'AllowIsaDeclarationOverdueEmails1791868500000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.replace(queryRunner, [...TEMPLATES, 'isa_declaration_overdue']);
  }

  // The template no longer exists: its emails, sent or not, go with it.
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM notifications.notification_log WHERE template = 'isa_declaration_overdue'`,
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
