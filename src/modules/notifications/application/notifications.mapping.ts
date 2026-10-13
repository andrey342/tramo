import { type WebhookDelivery, WEBHOOK_EVENTS, type WebhookSubscription } from '../domain';

import { type WebhookDeliveryDto, type WebhookSubscriptionDto } from './dto/notifications.dto';

export function toSubscriptionDto(subscription: WebhookSubscription): WebhookSubscriptionDto {
  return {
    centerId: subscription.centerId,
    url: subscription.url,
    status: subscription.status,
    events: WEBHOOK_EVENTS,
    createdAt: subscription.createdAt,
    changedAt: subscription.changedAt,
  };
}

export function toDeliveryDto(delivery: WebhookDelivery): WebhookDeliveryDto {
  const last = delivery.lastAttempt;
  return {
    id: delivery.id,
    eventId: delivery.eventId,
    event: delivery.event,
    status: delivery.status,
    round: delivery.round,
    attempts: delivery.attempts.length,
    lastStatusCode: last?.statusCode ?? null,
    lastError: last?.error ?? null,
    data: delivery.data,
    occurredAt: delivery.occurredAt,
    createdAt: delivery.createdAt,
    deliveredAt: delivery.deliveredAt,
  };
}
