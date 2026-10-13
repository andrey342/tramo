import { type MigrationInterface, type QueryRunner } from 'typeorm';

// The secret a rotation replaced, kept for a while so deliveries are signed with both until the
// center deploys the new one (ADR 018). Encrypted and bound to its row like the current secret
// (ADR 014); both columns are set together, and null when there is nothing to overlap.
export class AddWebhookSubscriptionsPreviousSecret1791884040000 implements MigrationInterface {
  name = 'AddWebhookSubscriptionsPreviousSecret1791884040000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications.webhook_subscriptions
        ADD COLUMN previous_secret_encrypted text NULL,
        ADD COLUMN previous_secret_expires_at timestamptz(3) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE notifications.webhook_subscriptions
        ADD CONSTRAINT ck_notifications_webhook_subscriptions_previous_secret
        CHECK ((previous_secret_encrypted IS NULL) = (previous_secret_expires_at IS NULL))
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE notifications.webhook_subscriptions
        DROP CONSTRAINT ck_notifications_webhook_subscriptions_previous_secret
    `);
    await queryRunner.query(`
      ALTER TABLE notifications.webhook_subscriptions
        DROP COLUMN previous_secret_expires_at,
        DROP COLUMN previous_secret_encrypted
    `);
  }
}
