import { InvalidStateTransitionError } from '@shared/domain';

import { aDelivery, LATER, NOW } from '../../../../../test/factories/notifications';
import { WebhookDeliveryInProgressError } from '../errors/notifications-errors';
import { NotificationsEvents } from '../events/notifications-events';

import { STALE_ROUND_MS, WebhookDelivery } from './webhook-delivery';

const eventTypes = (delivery: WebhookDelivery): string[] =>
  delivery.pullEvents().map((event) => event.eventType);
const after = (ms: number): Date => new Date(NOW.getTime() + ms);

describe('WebhookDelivery', () => {
  it('should be requested pending, in its first round', () => {
    const delivery = aDelivery();

    expect(delivery).toMatchObject({
      status: 'pending',
      round: 1,
      attempts: [],
      roundStartedAt: NOW,
    });
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

  it('should retry what is not a 2xx, and be delivered by a 2xx, once', () => {
    const delivery = aDelivery();
    delivery.pullEvents();

    const outcomes = [
      delivery.recordAttempt(1, { statusCode: 503 }, false, NOW),
      delivery.recordAttempt(1, { statusCode: 302 }, false, NOW),
      delivery.recordAttempt(1, { statusCode: null, error: 'x'.repeat(200) }, false, NOW),
      delivery.recordAttempt(1, { statusCode: 204 }, false, LATER),
      delivery.recordAttempt(1, { statusCode: 200 }, false, LATER),
    ];

    expect(outcomes).toEqual(['retry', 'retry', 'retry', 'delivered', 'ignored']);
    expect(delivery).toMatchObject({ status: 'delivered', deliveredAt: LATER });
    expect(delivery.attempts.map((attempt) => attempt.error)).toEqual([
      'http_503',
      'http_302',
      'x'.repeat(100),
      null,
    ]);
    expect(eventTypes(delivery)).toEqual([NotificationsEvents.WebhookDelivered]);
  });

  it('should fail on the last attempt of the round, and be redelivered as a new round', () => {
    const delivery = aDelivery();
    delivery.pullEvents();

    const last = delivery.recordAttempt(1, { statusCode: 500 }, true, NOW);
    delivery.giveUp(1, 'internal_error', NOW);
    const round = delivery.redeliver(LATER);
    const stale = delivery.recordAttempt(1, { statusCode: 200 }, false, LATER);

    expect([last, stale]).toEqual(['failed', 'ignored']);
    expect(round).toBe(2);
    expect(delivery).toMatchObject({ status: 'pending', round: 2, roundStartedAt: LATER });
    expect(delivery.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: NotificationsEvents.WebhookDeliveryFailed,
        payload: expect.objectContaining({ lastError: 'http_500', round: 1 }),
      }),
      expect.objectContaining({
        eventType: NotificationsEvents.WebhookDeliveryRequested,
        payload: expect.objectContaining({ round: 2 }),
      }),
    ]);
  });

  it('should close a round whose job failed before posting', () => {
    const delivery = aDelivery();
    delivery.pullEvents();

    delivery.giveUp(1, 'internal_error', NOW);

    expect(delivery.status).toBe('failed');
    expect(delivery.lastAttempt).toMatchObject({ statusCode: null, error: 'internal_error' });
    expect(eventTypes(delivery)).toEqual([NotificationsEvents.WebhookDeliveryFailed]);
  });

  it('should not be redelivered while its round is alive, but only once it went quiet', () => {
    const delivery = aDelivery();
    delivery.recordAttempt(1, { statusCode: 503 }, false, after(60_000));

    expect(() => delivery.redeliver(after(STALE_ROUND_MS))).toThrow(WebhookDeliveryInProgressError);
    expect(delivery.redeliver(after(60_000 + STALE_ROUND_MS))).toBe(2);
  });

  it('should forget the earlier delivery time when redelivered', () => {
    const delivery = aDelivery();
    delivery.recordAttempt(1, { statusCode: 200 }, false, NOW);

    delivery.redeliver(LATER);
    delivery.recordAttempt(2, { statusCode: 500 }, true, LATER);

    expect(delivery).toMatchObject({ status: 'failed', deliveredAt: null });
  });

  it('should be given up when its center removed the webhook', () => {
    const delivery = aDelivery();
    delivery.pullEvents();

    delivery.cancel(NOW);

    expect(delivery.status).toBe('failed');
    expect(delivery.lastAttempt?.error).toBe('webhook_removed');
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
      roundStartedAt: LATER,
      attempts: [{ round: 3, at: LATER, statusCode: 204, error: null }],
      deliveredAt: LATER,
      createdAt: saved.createdAt,
    });

    expect(loaded).toMatchObject({ status: 'delivered', round: 3, createdAt: NOW });
    expect(loaded.hasPendingEvents).toBe(false);
  });
});
