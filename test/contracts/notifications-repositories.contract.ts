import { uuidv7 } from 'uuidv7';

import { type NotificationsQueries } from '../../src/modules/notifications/application/ports/notifications-ports';
import {
  type EmailNotificationRepository,
  type WebhookDeliveryRepository,
  type WebhookSubscriptionRepository,
} from '../../src/modules/notifications/domain';
import { aDelivery, anEmail, aSubscription, LATER, SECRET } from '../factories/notifications';

export interface NotificationsRepositoriesHarness {
  readonly subscriptions: WebhookSubscriptionRepository;
  readonly deliveries: WebhookDeliveryRepository;
  readonly emails: EmailNotificationRepository;
  readonly queries: NotificationsQueries;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

// The in-memory repositories of the unit tests and the TypeORM ones agree on these.
export function notificationsRepositoriesContract(
  name: string,
  create: () => Promise<NotificationsRepositoriesHarness> | NotificationsRepositoriesHarness,
): void {
  describe(`${name} (notifications repositories contract)`, () => {
    it('should store a subscription with its secret and find it by center', async () => {
      const { subscriptions, run } = await create();
      const subscription = aSubscription();
      await run(() => subscriptions.save(subscription));
      subscription.remove(LATER);
      await run(() => subscriptions.save(subscription));

      const found = await run(() => subscriptions.findByCenter(subscription.centerId));

      expect(found).toMatchObject({ id: subscription.id, secret: SECRET, status: 'removed' });
      expect((await run(() => subscriptions.findById(subscription.id)))?.version).toBe(2);
      expect(await run(() => subscriptions.findByCenter(uuidv7()))).toBeNull();
    });

    it('should refuse a second subscription for a center', async () => {
      const { subscriptions, run } = await create();
      const first = aSubscription();
      await run(() => subscriptions.save(first));

      await expect(
        run(() => subscriptions.save(aSubscription({ centerId: first.centerId }))),
      ).rejects.toMatchObject({ code: 'concurrent_modification' });
    });

    it('should store a delivery with its attempts and find it by its event', async () => {
      const { deliveries, run } = await create();
      const delivery = aDelivery();
      delivery.recordFailedAttempt(1, 503, 'Service Unavailable', LATER);
      await run(() => deliveries.save(delivery));

      const found = await run(() => deliveries.findByEvent(delivery.centerId, delivery.eventId));

      expect(found).toMatchObject({
        id: delivery.id,
        event: 'contract.signed',
        status: 'pending',
        round: 1,
        data: delivery.data,
      });
      expect(found?.attempts).toEqual([
        { round: 1, at: LATER, statusCode: 503, error: 'Service Unavailable' },
      ]);
      await expect(
        run(() =>
          deliveries.save(aDelivery({ centerId: delivery.centerId, eventId: delivery.eventId })),
        ),
      ).rejects.toMatchObject({ code: 'concurrent_modification' });
    });

    it('should list the deliveries of a center by status, newest first', async () => {
      const { deliveries, queries, run } = await create();
      const centerId = uuidv7();
      const [older, newer, other] = [aDelivery({ centerId }), aDelivery({ centerId }), aDelivery()];
      newer.recordDelivered(1, 200, LATER);
      await run(async () => {
        for (const delivery of [older, newer, other]) await deliveries.save(delivery);
      });

      const all = await run(() => queries.listDeliveries(centerId, {}, { limit: 10 }));
      const pending = await run(() =>
        queries.listDeliveries(centerId, { status: 'pending' }, { limit: 10 }),
      );

      expect(all.data.map((item) => item.id)).toEqual([newer.id, older.id]);
      expect(pending.data.map((item) => item.id)).toEqual([older.id]);
      expect(all.data[0]).toMatchObject({ status: 'delivered', lastStatusCode: 200, attempts: 1 });
    });

    it('should store an email once per event, template and recipient', async () => {
      const { emails, run } = await create();
      const email = anEmail();
      await run(() => emails.save(email));
      email.markSent(LATER);
      await run(() => emails.save(email));

      const found = await run(() => emails.findById(email.id));

      expect(found).toMatchObject({ status: 'sent', sentAt: LATER, attempts: 1 });
      expect(found?.recipient.value).toBe('student@example.com');
      expect(
        await run(() => emails.exists(email.eventId, email.template, 'student@example.com')),
      ).toBe(true);
      expect(await run(() => emails.exists(email.eventId, 'welcome', 'student@example.com'))).toBe(
        false,
      );
      await expect(
        run(() => emails.save(anEmail({ eventId: email.eventId, template: email.template }))),
      ).rejects.toMatchObject({ code: 'concurrent_modification' });
    });
  });
}
