import { Injectable } from '@nestjs/common';

import { Email, unwrap } from '@shared/domain';
import { FieldCipher } from '@shared/infrastructure/crypto';

import { EmailNotification, WebhookDelivery, WebhookSubscription } from '../../domain';

import {
  type EmailNotificationOrmEntity,
  type WebhookDeliveryOrmEntity,
  type WebhookSubscriptionOrmEntity,
} from './notifications.orm-entities';

// Binds the ciphertext to its row: copied into another subscription, it no longer decrypts
// (ADR 014).
const secretContext = (subscriptionId: string): string =>
  `notifications.webhook_subscriptions.secret:${subscriptionId}`;

// A class: it needs the cipher for the secret.
@Injectable()
export class WebhookSubscriptionMapper {
  constructor(private readonly cipher: FieldCipher) {}

  toDomain(row: WebhookSubscriptionOrmEntity): WebhookSubscription {
    const subscription = WebhookSubscription.reconstitute(row.id, {
      centerId: row.centerId,
      url: row.url,
      secret: this.cipher.decrypt(row.secretEncrypted, secretContext(row.id)),
      status: row.status,
      createdAt: row.createdAt,
      changedAt: row.changedAt,
    });
    subscription.markPersisted(row.version);
    return subscription;
  }

  toRow(
    subscription: WebhookSubscription,
  ): Omit<WebhookSubscriptionOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: subscription.id,
      centerId: subscription.centerId,
      url: subscription.url,
      secretEncrypted: this.cipher.encrypt(subscription.secret, secretContext(subscription.id)),
      status: subscription.status,
      createdAt: subscription.createdAt,
      changedAt: subscription.changedAt,
    };
  }
}

export const WebhookDeliveryMapper = {
  toDomain(row: WebhookDeliveryOrmEntity): WebhookDelivery {
    const delivery = WebhookDelivery.reconstitute(row.id, {
      centerId: row.centerId,
      eventId: row.eventId,
      event: row.event,
      data: row.data,
      occurredAt: row.occurredAt,
      status: row.status,
      round: row.round,
      roundStartedAt: row.roundStartedAt,
      attempts: row.attempts.map((attempt) => ({ ...attempt, at: new Date(attempt.at) })),
      deliveredAt: row.deliveredAt,
      createdAt: row.createdAt,
    });
    delivery.markPersisted(row.version);
    return delivery;
  },

  toRow(delivery: WebhookDelivery): Omit<WebhookDeliveryOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: delivery.id,
      centerId: delivery.centerId,
      eventId: delivery.eventId,
      event: delivery.event,
      data: { ...delivery.data },
      occurredAt: delivery.occurredAt,
      status: delivery.status,
      round: delivery.round,
      roundStartedAt: delivery.roundStartedAt,
      attempts: delivery.attempts.map((attempt) => ({
        ...attempt,
        at: attempt.at.toISOString(),
      })),
      deliveredAt: delivery.deliveredAt,
      createdAt: delivery.createdAt,
    };
  },
};

export const EmailNotificationMapper = {
  toDomain(row: EmailNotificationOrmEntity): EmailNotification {
    const notification = EmailNotification.reconstitute(row.id, {
      eventId: row.eventId,
      template: row.template,
      recipient: unwrap(Email.create(row.recipient)),
      reference: row.reference,
      data: row.data,
      status: row.status,
      attempts: row.attempts,
      lastError: row.lastError,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    });
    notification.markPersisted(row.version);
    return notification;
  },

  toRow(
    notification: EmailNotification,
  ): Omit<EmailNotificationOrmEntity, 'version' | 'updatedAt'> {
    return {
      id: notification.id,
      eventId: notification.eventId,
      channel: 'email',
      template: notification.template,
      recipient: notification.recipient.value,
      reference: notification.reference,
      data: { ...notification.data },
      status: notification.status,
      attempts: notification.attempts,
      lastError: notification.lastError,
      sentAt: notification.sentAt,
      createdAt: notification.createdAt,
    };
  },
};
