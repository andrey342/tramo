import { type MigrationInterface, type QueryRunner } from 'typeorm';

export class CreateSharedMessaging1791565200000 implements MigrationInterface {
  name = 'CreateSharedMessaging1791565200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS shared`);

    await queryRunner.query(`
      CREATE TABLE shared.outbox_messages (
        id uuid PRIMARY KEY,
        aggregate_type text NOT NULL,
        aggregate_id text NOT NULL,
        event_type text NOT NULL,
        payload jsonb NOT NULL,
        occurred_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        correlation_id text NULL,
        published_at timestamptz NULL,
        attempts integer NOT NULL DEFAULT 0 CONSTRAINT ck_shared_outbox_messages_attempts CHECK (attempts >= 0),
        last_error text NULL
      )
    `);
    // The publisher only ever scans unpublished rows in id (UUIDv7, time-ordered) order.
    await queryRunner.query(`
      CREATE INDEX ix_shared_outbox_messages_unpublished
        ON shared.outbox_messages (id)
        WHERE published_at IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX ix_shared_outbox_messages_aggregate
        ON shared.outbox_messages (aggregate_type, aggregate_id, id)
    `);

    await queryRunner.query(`
      CREATE TABLE shared.processed_events (
        event_id text NOT NULL,
        consumer text NOT NULL,
        processed_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_shared_processed_events PRIMARY KEY (event_id, consumer)
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE shared.processed_events`);
    await queryRunner.query(`DROP TABLE shared.outbox_messages`);
  }
}
