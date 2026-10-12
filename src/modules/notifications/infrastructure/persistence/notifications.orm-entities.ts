import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { type JsonValue } from '@shared/domain';

import {
  type DeliveryStatus,
  type EmailStatus,
  type EmailTemplate,
  type SubscriptionStatus,
  type WebhookEvent,
} from '../../domain';

export interface DeliveryAttemptJson {
  readonly round: number;
  readonly at: string;
  readonly statusCode: number | null;
  readonly error: string | null;
}

@Entity({ schema: 'notifications', name: 'webhook_subscriptions' })
export class WebhookSubscriptionOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  // catalog's training center (no cross-schema keys, ADR 008).
  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('text')
  url: string;

  // Encrypted, bound to the row (ADR 014).
  @Column('text', { name: 'secret_encrypted' })
  secretEncrypted: string;

  @Column('text')
  status: SubscriptionStatus;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'changed_at', precision: 3 })
  changedAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

@Entity({ schema: 'notifications', name: 'webhook_deliveries' })
export class WebhookDeliveryOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('uuid', { name: 'event_id' })
  eventId: string;

  @Column('text')
  event: WebhookEvent;

  @Column('jsonb')
  data: Record<string, JsonValue>;

  @Column({ type: 'timestamptz', name: 'occurred_at', precision: 3 })
  occurredAt: Date;

  @Column('text')
  status: DeliveryStatus;

  @Column('integer')
  round: number;

  @Column('jsonb')
  attempts: DeliveryAttemptJson[];

  @Column({ type: 'timestamptz', name: 'delivered_at', precision: 3, nullable: true })
  deliveredAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}

@Entity({ schema: 'notifications', name: 'notification_log' })
export class EmailNotificationOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'event_id' })
  eventId: string;

  @Column('text')
  channel: 'email';

  @Column('text')
  template: EmailTemplate;

  @Column('text')
  recipient: string;

  @Column('text')
  reference: string;

  @Column('jsonb')
  data: Record<string, JsonValue>;

  @Column('text')
  status: EmailStatus;

  @Column('integer')
  attempts: number;

  @Column('text', { name: 'last_error', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamptz', name: 'sent_at', precision: 3, nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}
