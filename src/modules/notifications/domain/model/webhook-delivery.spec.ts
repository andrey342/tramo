import { InvalidStateTransitionError } from '@shared/domain';

import { aDelivery, LATER, NOW } from '../../../../../test/factories/notifications';
import { WebhookDeliveryInProgressError } from '../errors/notifications-errors';
import { NotificationsEvents } from '../events/notifications-events';

import { WebhookDelivery } from './webhook-delivery';

const eventTypes = (delivery: WebhookDelivery): string[] =>
  delivery.pullEvents().map((event) => event.eventType);

describe('WebhookDelivery', () => {
  it('should be requested pending, in its first round', () => {
    const delivery = aDelivery();

    expect(delivery).toMatchObject({ status: 'pending', round: 1, attempts: [] });
    expect(delivery.awaits(1)).toBe(true);
    expect(delivery.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: NotificationsEvents.WebhookDeliveryRequested,
        payload: {
          deliveryId: delivery.id,
          centerId: delivery.centerId,
          event: 'contract.signed',
          round: 1,
        },
      }),
    ]);
  });

  it('should be delivered on a 2xx after failed attempts, once', () => {
    const delivery = aDelivery();
    delivery.pullEvents();

    delivery.recordFailedAttempt(1, 503, 'Service Unavailable', NOW);
    delivery.recordFailedAttempt(1, null, 'x'.repeat(500), NOW);
    delivery.recordDelivered(1, 200, LATER);
    delivery.recordDelivered(1, 200, LATER);
    delivery.recordFailedAttempt(1, 500, 'late', LATER);

    expect(delivery).toMatchObject({ status: 'delivered', deliveredAt: LATER });
    expect(delivery.attempts.map((attempt) => attempt.statusCode)).toEqual([503, null, 200]);
    expect(delivery.attempts[1]?.error).toHaveLength(300);
    expect(eventTypes(delivery)).toEqual([NotificationsEvents.WebhookDelivered]);
  });

  it('should fail when the round runs out, and be redelivered as a new round', () => {
    const delivery = aDelivery();
    delivery.pullEvents();
    delivery.recordFailedAttempt(1, 500, 'Internal Server Error', NOW);

    delivery.giveUp(1, NOW);
    delivery.giveUp(1, NOW);
    const round = delivery.redeliver(LATER);
    delivery.recordDelivered(1, 200, LATER);

    expect(round).toBe(2);
    expect(delivery).toMatchObject({ status: 'pending', round: 2 });
    expect(delivery.awaits(1)).toBe(false);
    expect(delivery.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: NotificationsEvents.WebhookDeliveryFailed,
        payload: expect.objectContaining({ lastError: 'Internal Server Error', round: 1 }),
      }),
      expect.objectContaining({
        eventType: NotificationsEvents.WebhookDeliveryRequested,
        payload: expect.objectContaining({ round: 2 }),
      }),
    ]);
  });

  it('should not be redelivered while a round is in progress', () => {
    expect(() => aDelivery().redeliver(NOW)).toThrow(WebhookDeliveryInProgressError);
  });

  it('should be given up when its center removed the webhook', () => {
    const delivery = aDelivery();
    delivery.pullEvents();

    delivery.cancel(NOW);

    expect(delivery.status).toBe('failed');
    expect(delivery.lastAttempt?.error).toBe('webhook removed');
    expect(eventTypes(delivery)).toEqual([NotificationsEvents.WebhookDeliveryFailed]);
    expect(() => {
      delivery.cancel(NOW);
    }).toThrow(InvalidStateTransitionError);
  });

  it('should be reconstituted as saved, without events', () => {
    const saved = aDelivery();

    const loaded = WebhookDelivery.reconstitute(saved.id, {
      centerId: saved.centerId,
      eventId: saved.eventId,
      event: saved.event,
      data: saved.data,
      occurredAt: saved.occurredAt,
      status: 'delivered',
      round: 3,
      attempts: [{ round: 3, at: LATER, statusCode: 204, error: null }],
      deliveredAt: LATER,
      createdAt: saved.createdAt,
    });

    expect(loaded).toMatchObject({ status: 'delivered', round: 3, createdAt: NOW });
    expect(loaded.hasPendingEvents).toBe(false);
  });
});
