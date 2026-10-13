import { notificationsRepositoriesContract } from '../../../../../test/contracts/notifications-repositories.contract';
import {
  InMemoryEmailNotificationRepository,
  InMemoryNotificationsQueries,
  InMemoryWebhookDeliveryRepository,
  InMemoryWebhookSubscriptionRepository,
} from '../../../../../test/fakes/notifications';
import { RecordingEventBus } from '../../../../../test/fakes/shared';

notificationsRepositoriesContract('in-memory', () => {
  const events = new RecordingEventBus();
  const deliveries = new InMemoryWebhookDeliveryRepository(events);
  return {
    subscriptions: new InMemoryWebhookSubscriptionRepository(events),
    deliveries,
    emails: new InMemoryEmailNotificationRepository(events),
    queries: new InMemoryNotificationsQueries(deliveries),
    run: (work) => work(),
  };
});
