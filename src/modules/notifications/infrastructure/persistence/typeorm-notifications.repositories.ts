import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { LessThan } from 'typeorm';

import { ConcurrentModificationError } from '@shared/domain';
import {
  AggregatePersister,
  isUniqueViolation,
} from '@shared/infrastructure/database/aggregate-persister';

import {
  type EmailNotification,
  type EmailNotificationRepository,
  type EmailTemplate,
  type WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookSubscription,
  type WebhookSubscriptionRepository,
} from '../../domain';

import {
  EmailNotificationMapper,
  WebhookDeliveryMapper,
  WebhookSubscriptionMapper,
} from './notifications.mappers';
import {
  EmailNotificationOrmEntity,
  WebhookDeliveryOrmEntity,
  WebhookSubscriptionOrmEntity,
} from './notifications.orm-entities';

// A unique index lost to a concurrent writer: the same outcome as an optimistic-lock conflict,
// and a consumer retried after it finds the row written.
async function saveOnce(
  save: () => Promise<void>,
  constraint: string,
  entity: string,
  id: string,
): Promise<void> {
  try {
    await save();
  } catch (error) {
    if (isUniqueViolation(error, constraint)) {
      throw new ConcurrentModificationError(entity, id);
    }
    throw error;
  }
}

@Injectable()
export class TypeOrmWebhookSubscriptionRepository implements WebhookSubscriptionRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
    private readonly mapper: WebhookSubscriptionMapper,
  ) {}

  async findById(id: string): Promise<WebhookSubscription | null> {
    const row = await this.txHost.tx.findOneBy(WebhookSubscriptionOrmEntity, { id });
    return row ? this.mapper.toDomain(row) : null;
  }

  async findByCenter(centerId: string): Promise<WebhookSubscription | null> {
    const row = await this.txHost.tx.findOneBy(WebhookSubscriptionOrmEntity, { centerId });
    return row ? this.mapper.toDomain(row) : null;
  }

  save(subscription: WebhookSubscription): Promise<void> {
    return saveOnce(
      () =>
        this.persister.save(
          WebhookSubscriptionOrmEntity,
          subscription,
          this.mapper.toRow(subscription),
          'WebhookSubscription',
        ),
      'ux_notifications_webhook_subscriptions_center_id',
      'WebhookSubscription',
      subscription.id,
    );
  }
}

@Injectable()
export class TypeOrmWebhookDeliveryRepository implements WebhookDeliveryRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<WebhookDelivery | null> {
    const row = await this.txHost.tx.findOneBy(WebhookDeliveryOrmEntity, { id });
    return row ? WebhookDeliveryMapper.toDomain(row) : null;
  }

  async findByEvent(centerId: string, eventId: string): Promise<WebhookDelivery | null> {
    const row = await this.txHost.tx.findOneBy(WebhookDeliveryOrmEntity, { centerId, eventId });
    return row ? WebhookDeliveryMapper.toDomain(row) : null;
  }

  save(delivery: WebhookDelivery): Promise<void> {
    return saveOnce(
      () =>
        this.persister.save(
          WebhookDeliveryOrmEntity,
          delivery,
          WebhookDeliveryMapper.toRow(delivery),
          'WebhookDelivery',
        ),
      'ux_notifications_webhook_deliveries_center_id_event_id',
      'WebhookDelivery',
      delivery.id,
    );
  }
}

@Injectable()
export class TypeOrmEmailNotificationRepository implements EmailNotificationRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<EmailNotification | null> {
    const row = await this.txHost.tx.findOneBy(EmailNotificationOrmEntity, { id });
    return row ? EmailNotificationMapper.toDomain(row) : null;
  }

  exists(eventId: string, template: EmailTemplate, recipient: string): Promise<boolean> {
    return this.txHost.tx.exists(EmailNotificationOrmEntity, {
      where: { eventId, template, recipient },
    });
  }

  // Served by ix_notifications_notification_log_pending_created_at.
  async findPendingIds(before: Date, limit: number): Promise<string[]> {
    const rows = await this.txHost.tx.find(EmailNotificationOrmEntity, {
      select: { id: true },
      where: { status: 'pending', createdAt: LessThan(before) },
      order: { createdAt: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  save(notification: EmailNotification): Promise<void> {
    return saveOnce(
      () =>
        this.persister.save(
          EmailNotificationOrmEntity,
          notification,
          EmailNotificationMapper.toRow(notification),
          'EmailNotification',
        ),
      'ux_notifications_notification_log_event_id_template_recipient',
      'EmailNotification',
      notification.id,
    );
  }
}
