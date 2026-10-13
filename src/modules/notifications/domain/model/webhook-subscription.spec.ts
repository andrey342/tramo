import {
  aSubscription,
  LATER,
  NOW,
  SECRET,
  SINK_URL,
} from '../../../../../test/factories/notifications';
import { InvalidWebhookUrlError } from '../errors/notifications-errors';
import { NotificationsEvents } from '../events/notifications-events';

import { parseWebhookUrl, WebhookSubscription } from './webhook-subscription';

describe('WebhookSubscription', () => {
  it('should subscribe a center to its URL and announce it', () => {
    const subscription = aSubscription();

    expect(subscription).toMatchObject({
      url: SINK_URL,
      secret: SECRET,
      status: 'active',
      active: true,
      createdAt: NOW,
    });
    expect(subscription.pullEvents()).toEqual([
      expect.objectContaining({
        eventType: NotificationsEvents.WebhookSubscribed,
        payload: { subscriptionId: subscription.id, centerId: subscription.centerId },
      }),
    ]);
  });

  it.each([
    ['an empty URL', '  '],
    ['a relative URL', '/hooks'],
    ['another scheme', 'ftp://center.example/hooks'],
    ['credentials', 'https://user:pass@center.example/hooks'],
    ['a fragment', 'https://center.example/hooks#part'],
    ['a URL too long', `https://center.example/${'a'.repeat(2_000)}`],
  ])('should refuse %s', (_case, url) => {
    expect(() => parseWebhookUrl(url)).toThrow(InvalidWebhookUrlError);
  });

  it('should keep the URL as given, trimmed', () => {
    expect(parseWebhookUrl(' https://center.example/hooks?source=tramo ')).toBe(
      'https://center.example/hooks?source=tramo',
    );
  });

  it('should take a new URL and secret, and come back once removed', () => {
    const subscription = aSubscription();
    subscription.pullEvents();

    subscription.remove(LATER);
    subscription.remove(LATER);
    subscription.reconfigure('https://center.example/hooks', 'whsec_new', LATER);

    expect(subscription).toMatchObject({
      url: 'https://center.example/hooks',
      secret: 'whsec_new',
      status: 'active',
      changedAt: LATER,
    });
    expect(subscription.pullEvents().map((event) => event.eventType)).toEqual([
      NotificationsEvents.WebhookUnsubscribed,
      NotificationsEvents.WebhookSubscribed,
    ]);
  });

  it('should be reconstituted as saved, without events', () => {
    const saved = aSubscription();

    const loaded = WebhookSubscription.reconstitute(saved.id, {
      centerId: saved.centerId,
      url: saved.url,
      secret: saved.secret,
      status: 'removed',
      createdAt: saved.createdAt,
      changedAt: saved.changedAt,
    });

    expect(loaded).toMatchObject({ status: 'removed', active: false });
    expect(loaded.hasPendingEvents).toBe(false);
  });
});
