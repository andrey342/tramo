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
]
  .map((template) => `'${template}'`)
  .join(', ');

const EVENTS = [
  'application.submitted',
  'application.decided',
  'contract.signed',
  'disbursement.settled',
  'contract.in_arrears',
  'contract.defaulted',
]
  .map((event) => `'${event}'`)
  .join(', ');

export class CreateNotificationsTables1791844440000 implements MigrationInterface {
  name = 'CreateNotificationsTables1791844440000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE notifications.webhook_subscriptions (
        id uuid NOT NULL,
        -- catalog's training center: another schema, so not a foreign key (ADR 008).
        center_id uuid NOT NULL,
        url text NOT NULL CONSTRAINT ck_notifications_webhook_subscriptions_url
          CHECK (url ~ '^https?://' AND length(url) <= 2000),
        -- The HMAC key, encrypted and bound to the row (ADR 014).
        secret_encrypted text NOT NULL,
        status text NOT NULL CONSTRAINT ck_notifications_webhook_subscriptions_status
          CHECK (status IN ('active', 'removed')),
        created_at timestamptz(3) NOT NULL,
        changed_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_notifications_webhook_subscriptions_version
          CHECK (version > 0),
        CONSTRAINT pk_notifications_webhook_subscriptions PRIMARY KEY (id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_notifications_webhook_subscriptions_center_id
        ON notifications.webhook_subscriptions (center_id)
    `);
    await queryRunner.query(`
      CREATE TABLE notifications.webhook_deliveries (
        id uuid NOT NULL,
        center_id uuid NOT NULL,
        -- The Tramo event reported (shared.outbox_messages).
        event_id uuid NOT NULL,
        event text NOT NULL CONSTRAINT ck_notifications_webhook_deliveries_event
          CHECK (event IN (${EVENTS})),
        data jsonb NOT NULL,
        occurred_at timestamptz(3) NOT NULL,
        status text NOT NULL CONSTRAINT ck_notifications_webhook_deliveries_status
          CHECK (status IN ('pending', 'delivered', 'failed')),
        round integer NOT NULL CONSTRAINT ck_notifications_webhook_deliveries_round
          CHECK (round > 0),
        round_started_at timestamptz(3) NOT NULL,
        attempts jsonb NOT NULL,
        delivered_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_notifications_webhook_deliveries_version
          CHECK (version > 0),
        CONSTRAINT pk_notifications_webhook_deliveries PRIMARY KEY (id),
        CONSTRAINT ck_notifications_webhook_deliveries_delivered CHECK (
          status <> 'delivered' OR delivered_at IS NOT NULL
        )
      )
    `);
    // One delivery per center and event: a redelivered event finds it.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_notifications_webhook_deliveries_center_id_event_id
        ON notifications.webhook_deliveries (center_id, event_id)
    `);
    // A center's deliveries, newest first.
    await queryRunner.query(`
      CREATE INDEX ix_notifications_webhook_deliveries_center_id_created_at_id
        ON notifications.webhook_deliveries (center_id, created_at DESC, id DESC)
    `);
    await queryRunner.query(`
      CREATE TABLE notifications.notification_log (
        id uuid NOT NULL,
        event_id uuid NOT NULL,
        channel text NOT NULL CONSTRAINT ck_notifications_notification_log_channel
          CHECK (channel = 'email'),
        template text NOT NULL CONSTRAINT ck_notifications_notification_log_template
          CHECK (template IN (${TEMPLATES})),
        recipient text NOT NULL,
        -- The id the email is about (an application, a contract), for support searches.
        reference text NOT NULL,
        data jsonb NOT NULL,
        status text NOT NULL CONSTRAINT ck_notifications_notification_log_status
          CHECK (status IN ('pending', 'sent', 'failed')),
        attempts integer NOT NULL CONSTRAINT ck_notifications_notification_log_attempts
          CHECK (attempts >= 0),
        last_error text NULL,
        sent_at timestamptz(3) NULL,
        created_at timestamptz(3) NOT NULL,
        updated_at timestamptz(3) NOT NULL DEFAULT now(),
        version integer NOT NULL CONSTRAINT ck_notifications_notification_log_version
          CHECK (version > 0),
        CONSTRAINT pk_notifications_notification_log PRIMARY KEY (id),
        CONSTRAINT ck_notifications_notification_log_sent CHECK (
          (status = 'sent') = (sent_at IS NOT NULL)
        )
      )
    `);
    // One email per event, template and recipient.
    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_notifications_notification_log_event_id_template_recipient
        ON notifications.notification_log (event_id, template, recipient)
    `);
    // The hourly sweep of emails whose job was lost.
    await queryRunner.query(`
      CREATE INDEX ix_notifications_notification_log_pending_created_at
        ON notifications.notification_log (created_at, id)
        WHERE status = 'pending'
    `);
    // What was written about an application or a contract.
    await queryRunner.query(`
      CREATE INDEX ix_notifications_notification_log_reference
        ON notifications.notification_log (reference)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE notifications.notification_log`);
    await queryRunner.query(`DROP TABLE notifications.webhook_deliveries`);
    await queryRunner.query(`DROP TABLE notifications.webhook_subscriptions`);
  }
}
