import { uuidv7 } from 'uuidv7';

import { type Principal } from '@shared/application';
import { EntityNotFoundError, FixedClock } from '@shared/domain';

import { NOW } from '../../../../test/factories/notifications';
import {
  FakeCenters,
  FakeEmailRenderer,
  FakeEmailSender,
  FakeRecipients,
  FakeWebhookSender,
  InMemoryEmailNotificationRepository,
  InMemoryNotificationsQueries,
  InMemoryWebhookDeliveryRepository,
  InMemoryWebhookSubscriptionRepository,
  SequentialWebhookSecrets,
} from '../../../../test/fakes/notifications';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  InvalidWebhookUrlError,
  NotificationsAccessDeniedError,
  NotificationsEvents,
  WebhookDeliveryInProgressError,
  WebhookDeliveryNotFoundError,
  WebhookNotConfiguredError,
} from '../domain';

import {
  ConfigureWebhookCommand,
  ConfigureWebhookHandler,
} from './commands/configure-webhook.command';
import {
  DeliverWebhookCommand,
  DeliverWebhookHandler,
  WebhookAttemptFailedError,
} from './commands/deliver-webhook.command';
import { PublishWebhookCommand, PublishWebhookHandler } from './commands/publish-webhook.command';
import {
  RedeliverWebhookCommand,
  RedeliverWebhookHandler,
} from './commands/redeliver-webhook.command';
import { RemoveWebhookCommand, RemoveWebhookHandler } from './commands/remove-webhook.command';
import { RequestEmailCommand, RequestEmailHandler } from './commands/request-email.command';
import {
  EmailNotSentError,
  SendEmailCommand,
  SendEmailHandler,
} from './commands/send-email.command';
import { GetWebhookHandler, GetWebhookQuery } from './queries/get-webhook.query';
import {
  ListWebhookDeliveriesHandler,
  ListWebhookDeliveriesQuery,
} from './queries/list-webhook-deliveries.query';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };
const PAGE = { limit: 20 };

function setup() {
  const clock = new FixedClock(NOW);
  const events = new RecordingEventBus();
  const uow = new InlineUnitOfWork();
  const subscriptions = new InMemoryWebhookSubscriptionRepository(events);
  const deliveries = new InMemoryWebhookDeliveryRepository(events);
  const emails = new InMemoryEmailNotificationRepository(events);
  const centers = new FakeCenters();
  const recipients = new FakeRecipients();
  const webhookSender = new FakeWebhookSender();
  const emailSender = new FakeEmailSender();
  const centerId = uuidv7();
  centers.ids.add(centerId);
  const admin: Principal = {
    kind: 'user',
    userId: uuidv7(),
    roles: ['center_admin'],
    centerId,
  };
  const configure = new ConfigureWebhookHandler(
    uow,
    subscriptions,
    centers,
    new SequentialWebhookSecrets(),
    clock,
  );
  const publish = new PublishWebhookHandler(uow, subscriptions, deliveries, clock);
  return {
    clock,
    events,
    subscriptions,
    deliveries,
    emails,
    centers,
    recipients,
    webhookSender,
    emailSender,
    centerId,
    admin,
    configure,
    publish,
    remove: new RemoveWebhookHandler(uow, subscriptions, clock),
    get: new GetWebhookHandler(subscriptions),
    deliver: new DeliverWebhookHandler(uow, deliveries, subscriptions, webhookSender, clock),
    redeliver: new RedeliverWebhookHandler(uow, deliveries, subscriptions, clock),
    list: new ListWebhookDeliveriesHandler(new InMemoryNotificationsQueries(deliveries)),
    request: new RequestEmailHandler(uow, emails, recipients, clock),
    send: new SendEmailHandler(uow, emails, new FakeEmailRenderer(), emailSender, clock),
    subscribed: async () =>
      configure.execute(
        new ConfigureWebhookCommand(admin, centerId, 'https://center.example/hooks'),
      ),
    published: async (event: 'contract.signed' | 'contract.defaulted' = 'contract.signed') => {
      const eventId = uuidv7();
      await publish.execute(
        new PublishWebhookCommand({
          eventId,
          centerId,
          event,
          occurredAt: NOW,
          data: { contractId: 'c-1' },
        }),
      );
      const delivery = await deliveries.findByEvent(centerId, eventId);
      if (!delivery) throw new Error('no delivery');
      return delivery;
    },
  };
}

describe('notifications use cases', () => {
  describe('webhook configuration', () => {
    it('should let a center admin point its webhook at a URL, with a secret shown once', async () => {
      const t = setup();

      const first = await t.subscribed();
      const rotated = await t.configure.execute(
        new ConfigureWebhookCommand(t.admin, t.centerId, 'https://center.example/hooks'),
      );
      const read = await t.get.execute(new GetWebhookQuery(t.admin, t.centerId));

      expect(first).toMatchObject({
        centerId: t.centerId,
        url: 'https://center.example/hooks',
        status: 'active',
        secret: expect.stringMatching(/^whsec_/),
      });
      expect(rotated.secret).not.toBe(first.secret);
      expect(read).not.toHaveProperty('secret');
      expect(read.events).toContain('contract.in_arrears');
      expect(t.subscriptions.all()).toHaveLength(1);
      expect(t.events.ofType(NotificationsEvents.WebhookSubscribed)).toHaveLength(2);
    });

    it('should keep the webhook to the admins of the center and to a known center', async () => {
      const t = setup();
      const otherCenter: Principal = { ...t.admin, centerId: uuidv7() };
      const unknown = uuidv7();

      await expect(
        t.configure.execute(new ConfigureWebhookCommand(OPS, t.centerId, 'https://x.example')),
      ).rejects.toThrow(NotificationsAccessDeniedError);
      await expect(
        t.configure.execute(
          new ConfigureWebhookCommand(otherCenter, t.centerId, 'https://x.example'),
        ),
      ).rejects.toThrow(NotificationsAccessDeniedError);
      await expect(
        t.configure.execute(
          new ConfigureWebhookCommand(
            { ...t.admin, centerId: unknown },
            unknown,
            'https://x.example',
          ),
        ),
      ).rejects.toThrow(EntityNotFoundError);
      await expect(
        t.configure.execute(new ConfigureWebhookCommand(t.admin, t.centerId, 'ftp://x.example')),
      ).rejects.toThrow(InvalidWebhookUrlError);
    });

    it('should remove the webhook, after which there is none to read or remove', async () => {
      const t = setup();
      await t.subscribed();

      await t.remove.execute(new RemoveWebhookCommand(t.admin, t.centerId));

      await expect(t.get.execute(new GetWebhookQuery(OPS, t.centerId))).rejects.toThrow(
        WebhookNotConfiguredError,
      );
      await expect(t.remove.execute(new RemoveWebhookCommand(t.admin, t.centerId))).rejects.toThrow(
        WebhookNotConfiguredError,
      );
    });
  });

  describe('deliveries', () => {
    it('should write one delivery per event, and none for a center without a webhook', async () => {
      const t = setup();
      const notice = {
        eventId: uuidv7(),
        centerId: t.centerId,
        event: 'contract.signed' as const,
        occurredAt: NOW,
        data: { contractId: 'c-1' },
      };

      const before = await t.publish.execute(new PublishWebhookCommand(notice));
      await t.subscribed();
      const first = await t.publish.execute(new PublishWebhookCommand(notice));
      const again = await t.publish.execute(new PublishWebhookCommand(notice));

      expect([before, first, again]).toEqual([false, true, false]);
      expect(t.deliveries.all()).toHaveLength(1);
      expect(t.events.ofType(NotificationsEvents.WebhookDeliveryRequested)).toHaveLength(1);
    });

    it('should post the event signed with the center secret, and deliver it on a 2xx', async () => {
      const t = setup();
      const { secret } = await t.subscribed();
      const delivery = await t.published();

      const outcome = await t.deliver.execute(new DeliverWebhookCommand(delivery.id, 1, false));
      const again = await t.deliver.execute(new DeliverWebhookCommand(delivery.id, 1, false));

      expect([outcome, again]).toEqual(['delivered', 'skipped']);
      expect(t.webhookSender.posts).toHaveLength(1);
      expect(t.webhookSender.posts[0]).toMatchObject({
        url: 'https://center.example/hooks',
        secret,
        deliveryId: delivery.id,
        event: 'contract.signed',
      });
      expect(JSON.parse(t.webhookSender.posts[0]?.body ?? '')).toEqual({
        id: delivery.eventId,
        event: 'contract.signed',
        occurredAt: NOW.toISOString(),
        data: { contractId: 'c-1' },
      });
      expect((await t.deliveries.findById(delivery.id))?.status).toBe('delivered');
    });

    it('should record failed attempts for the job to retry, and end the round on the last', async () => {
      const t = setup();
      await t.subscribed();
      const delivery = await t.published();
      t.webhookSender.answers.push(503, new Error('connect ECONNREFUSED'));

      await expect(
        t.deliver.execute(new DeliverWebhookCommand(delivery.id, 1, false)),
      ).rejects.toThrow(WebhookAttemptFailedError);
      await expect(
        t.deliver.execute(new DeliverWebhookCommand(delivery.id, 1, true)),
      ).rejects.toThrow('ECONNREFUSED');

      const failed = await t.deliveries.findById(delivery.id);
      expect(failed).toMatchObject({ status: 'failed' });
      expect(failed?.attempts.map((attempt) => attempt.statusCode)).toEqual([503, null]);
      expect(t.events.ofType(NotificationsEvents.WebhookDeliveryFailed)).toHaveLength(1);
    });

    it('should give up a delivery whose center removed its webhook', async () => {
      const t = setup();
      await t.subscribed();
      const delivery = await t.published();
      await t.remove.execute(new RemoveWebhookCommand(t.admin, t.centerId));

      const outcome = await t.deliver.execute(new DeliverWebhookCommand(delivery.id, 1, false));

      expect(outcome).toBe('cancelled');
      expect(t.webhookSender.posts).toEqual([]);
      expect((await t.deliveries.findById(delivery.id))?.status).toBe('failed');
    });

    it('should redeliver a finished delivery as a new round, for its center or staff', async () => {
      const t = setup();
      await t.subscribed();
      const delivery = await t.published();
      const student: Principal = { kind: 'user', userId: 's', roles: ['student'], centerId: null };

      await expect(
        t.redeliver.execute(new RedeliverWebhookCommand(t.admin, t.centerId, delivery.id)),
      ).rejects.toThrow(WebhookDeliveryInProgressError);
      await t.deliver.execute(new DeliverWebhookCommand(delivery.id, 1, false));
      const redelivered = await t.redeliver.execute(
        new RedeliverWebhookCommand(OPS, t.centerId, delivery.id),
      );
      const outcome = await t.deliver.execute(new DeliverWebhookCommand(delivery.id, 2, false));

      expect(redelivered).toMatchObject({ status: 'pending', round: 2 });
      expect(outcome).toBe('delivered');
      expect(t.webhookSender.posts).toHaveLength(2);
      await expect(
        t.redeliver.execute(new RedeliverWebhookCommand(student, t.centerId, delivery.id)),
      ).rejects.toThrow(NotificationsAccessDeniedError);
      await expect(
        t.redeliver.execute(new RedeliverWebhookCommand(OPS, uuidv7(), delivery.id)),
      ).rejects.toThrow(WebhookDeliveryNotFoundError);
    });

    it('should list the deliveries of a center by status', async () => {
      const t = setup();
      await t.subscribed();
      const delivered = await t.published();
      const pending = await t.published('contract.defaulted');
      await t.deliver.execute(new DeliverWebhookCommand(delivered.id, 1, false));

      const page = await t.list.execute(
        new ListWebhookDeliveriesQuery(t.admin, t.centerId, { status: 'pending' }, PAGE),
      );

      expect(page.data).toEqual([
        expect.objectContaining({ id: pending.id, event: 'contract.defaulted', attempts: 0 }),
      ]);
    });
  });

  describe('emails', () => {
    it('should write one email per recipient and event, to a user, a center or an address', async () => {
      const t = setup();
      const userId = uuidv7();
      t.recipients.users.set(userId, 'student@example.com');
      t.recipients.centers.set(t.centerId, ['a@center.test', 'b@center.test']);
      const eventId = uuidv7();
      const request = (to: { userId: string } | { centerId: string } | { address: string }) =>
        new RequestEmailCommand({
          eventId,
          template: 'disbursement_settled',
          to,
          reference: 'ref-1',
          data: { amountCents: 7_125_00 },
        });

      const toUser = await t.request.execute(request({ userId }));
      const toCenter = await t.request.execute(request({ centerId: t.centerId }));
      const toAddress = await t.request.execute(request({ address: 'New@Example.com ' }));
      const repeated = await t.request.execute(request({ centerId: t.centerId }));
      const nobody = await t.request.execute(request({ userId: uuidv7() }));

      expect([toUser, toCenter, toAddress, repeated, nobody]).toEqual([1, 2, 1, 0, 0]);
      expect(t.emails.all().map((email) => email.recipient.value)).toContain('new@example.com');
      expect(t.events.ofType(NotificationsEvents.EmailRequested)).toHaveLength(4);
    });

    it('should send a pending email once, and give it up after the last failed attempt', async () => {
      const t = setup();
      await t.request.execute(
        new RequestEmailCommand({
          eventId: uuidv7(),
          template: 'welcome',
          to: { address: 'student@example.com' },
          reference: 'user-1',
          data: {},
        }),
      );
      const [email] = t.emails.all();
      const id = email?.id ?? '';

      const sent = await t.send.execute(new SendEmailCommand(id, false));
      const again = await t.send.execute(new SendEmailCommand(id, false));

      expect([sent, again]).toEqual(['sent', 'skipped']);
      expect(t.emailSender.sent).toEqual([
        expect.objectContaining({
          to: 'student@example.com',
          subject: 'welcome',
          reference: 'user-1',
        }),
      ]);

      await t.request.execute(
        new RequestEmailCommand({
          eventId: uuidv7(),
          template: 'welcome',
          to: { address: 'other@example.com' },
          reference: 'user-2',
          data: {},
        }),
      );
      const failing = t.emails.all().find((item) => item.reference === 'user-2');
      t.emailSender.failures.push('421 try later', '421 try later');
      await expect(t.send.execute(new SendEmailCommand(failing?.id ?? '', false))).rejects.toThrow(
        EmailNotSentError,
      );
      await expect(t.send.execute(new SendEmailCommand(failing?.id ?? '', true))).rejects.toThrow(
        EmailNotSentError,
      );
      expect(await t.emails.findById(failing?.id ?? '')).toMatchObject({
        status: 'failed',
        attempts: 2,
        lastError: '421 try later',
      });
      expect(t.events.ofType(NotificationsEvents.EmailFailed)).toHaveLength(1);
    });
  });
});
