import { type WebhookDeliveryDto } from '../../src/modules/notifications/application/dto/notifications.dto';
import { toDeliveryDto } from '../../src/modules/notifications/application/notifications.mapping';
import {
  type Centers,
  type DeliveryFilter,
  type EmailRenderer,
  type EmailSender,
  type NotificationsQueries,
  type OutgoingEmail,
  type Recipients,
  type RenderedEmail,
  type WebhookPost,
  EmailSendFailedError,
  WebhookPostFailedError,
  type WebhookSecrets,
  type WebhookSender,
  type WebhookTargets,
} from '../../src/modules/notifications/application/ports/notifications-ports';
import {
  type EmailNotification,
  type EmailNotificationRepository,
  type EmailTemplate,
  type WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookSubscription,
  type WebhookSubscriptionRepository,
} from '../../src/modules/notifications/domain';
import { type CursorPage, type PageRequest } from '../../src/shared/application';
import { ConcurrentModificationError, type JsonValue } from '../../src/shared/domain';

import { InMemoryRepository } from './shared';

export class InMemoryWebhookSubscriptionRepository
  extends InMemoryRepository<WebhookSubscription>
  implements WebhookSubscriptionRepository
{
  findByCenter(centerId: string): Promise<WebhookSubscription | null> {
    return Promise.resolve(this.all().find((item) => item.centerId === centerId) ?? null);
  }

  override async save(subscription: WebhookSubscription): Promise<void> {
    const twin = await this.findByCenter(subscription.centerId);
    if (twin && twin.id !== subscription.id) {
      throw new ConcurrentModificationError('WebhookSubscription', subscription.id);
    }
    await super.save(subscription);
  }
}

export class InMemoryWebhookDeliveryRepository
  extends InMemoryRepository<WebhookDelivery>
  implements WebhookDeliveryRepository
{
  findByEvent(centerId: string, eventId: string): Promise<WebhookDelivery | null> {
    return Promise.resolve(
      this.all().find((item) => item.centerId === centerId && item.eventId === eventId) ?? null,
    );
  }

  override async save(delivery: WebhookDelivery): Promise<void> {
    const twin = await this.findByEvent(delivery.centerId, delivery.eventId);
    if (twin && twin.id !== delivery.id) {
      throw new ConcurrentModificationError('WebhookDelivery', delivery.id);
    }
    await super.save(delivery);
  }
}

export class InMemoryEmailNotificationRepository
  extends InMemoryRepository<EmailNotification>
  implements EmailNotificationRepository
{
  exists(eventId: string, template: EmailTemplate, recipient: string): Promise<boolean> {
    return Promise.resolve(
      this.all().some(
        (item) =>
          item.eventId === eventId &&
          item.template === template &&
          item.recipient.value === recipient,
      ),
    );
  }

  findPendingIds(before: Date, limit: number): Promise<string[]> {
    return Promise.resolve(
      this.all()
        .filter((item) => item.pending && item.createdAt < before)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map((item) => item.id),
    );
  }

  override async save(notification: EmailNotification): Promise<void> {
    const twin = this.all().find(
      (item) =>
        item.id !== notification.id &&
        item.eventId === notification.eventId &&
        item.template === notification.template &&
        item.recipient.equals(notification.recipient),
    );
    if (twin) {
      throw new ConcurrentModificationError('EmailNotification', notification.id);
    }
    await super.save(notification);
  }
}

// Renders the template name and its values, so tests can see what reached the sender.
export class FakeEmailRenderer implements EmailRenderer {
  render(
    template: EmailTemplate,
    data: Readonly<Record<string, JsonValue>>,
    reference: string,
  ): RenderedEmail {
    const text = `${template} ${reference} ${JSON.stringify(data)}`;
    return { subject: template, text, html: `<p>${text}</p>` };
  }
}

export class FakeEmailSender implements EmailSender {
  readonly sent: OutgoingEmail[] = [];
  // Categories to fail the next calls with, in order.
  readonly failures: string[] = [];

  send(email: OutgoingEmail): Promise<void> {
    const failure = this.failures.shift();
    if (failure) {
      return Promise.reject(new EmailSendFailedError(failure));
    }
    this.sent.push(email);
    return Promise.resolve();
  }
}

// Answers each post with the next scripted status, or fails it with a category (a post
// without an answer); 200 once the script runs out.
export class FakeWebhookSender implements WebhookSender {
  readonly posts: WebhookPost[] = [];
  readonly answers: (number | string)[] = [];

  post(request: WebhookPost): Promise<{ readonly statusCode: number }> {
    this.posts.push(request);
    const answer = this.answers.shift() ?? 200;
    return typeof answer === 'string'
      ? Promise.reject(new WebhookPostFailedError(answer))
      : Promise.resolve({ statusCode: answer });
  }
}

// Allows every URL, or refuses those starting with the given prefixes.
export class FakeWebhookTargets implements WebhookTargets {
  readonly refused: string[] = [];

  refusal(url: string): string | null {
    return this.refused.some((prefix) => url.startsWith(prefix))
      ? 'only https to public addresses is delivered to'
      : null;
  }
}

export class SequentialWebhookSecrets implements WebhookSecrets {
  private issued = 0;

  generate(): string {
    this.issued += 1;
    return `whsec_test_${String(this.issued).padStart(32, '0')}`;
  }
}

export class FakeRecipients implements Recipients {
  readonly users = new Map<string, string>();
  readonly centers = new Map<string, string[]>();

  userEmail(userId: string): Promise<string | null> {
    return Promise.resolve(this.users.get(userId) ?? null);
  }

  centerContacts(centerId: string): Promise<readonly string[]> {
    return Promise.resolve(this.centers.get(centerId) ?? []);
  }
}

export class FakeCenters implements Centers {
  readonly ids = new Set<string>();

  exists(centerId: string): Promise<boolean> {
    return Promise.resolve(this.ids.has(centerId));
  }
}

export class InMemoryNotificationsQueries implements NotificationsQueries {
  constructor(private readonly deliveries: InMemoryWebhookDeliveryRepository) {}

  listDeliveries(
    centerId: string,
    filter: DeliveryFilter,
    page: PageRequest,
  ): Promise<CursorPage<WebhookDeliveryDto>> {
    const data = this.deliveries
      .all()
      .filter(
        (delivery) =>
          delivery.centerId === centerId &&
          (!filter.status || delivery.status === filter.status) &&
          (!filter.event || delivery.event === filter.event),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
    // The cursor is the id of the last delivery of the previous page.
    const start = page.cursor ? data.findIndex((delivery) => delivery.id === page.cursor) + 1 : 0;
    const slice = data.slice(start, start + page.limit);
    const more = start + page.limit < data.length;
    return Promise.resolve({
      data: slice.map(toDeliveryDto),
      nextCursor: more ? (slice.at(-1)?.id ?? null) : null,
    });
  }
}
