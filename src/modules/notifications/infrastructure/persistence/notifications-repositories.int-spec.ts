import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { notificationsRepositoriesContract } from '../../../../../test/contracts/notifications-repositories.contract';
import { aSubscription, LATER, SECRET } from '../../../../../test/factories/notifications';
import { NOTIFICATIONS_QUERIES } from '../../application/ports/notifications-ports';
import {
  EMAIL_NOTIFICATION_REPOSITORY,
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { NotificationsModule } from '../../notifications.module';

describe('notifications repositories (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), NotificationsModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
  });

  afterAll(async () => {
    await app.close();
  });

  notificationsRepositoriesContract('TypeORM', () => ({
    subscriptions: app.get(WEBHOOK_SUBSCRIPTION_REPOSITORY),
    deliveries: app.get(WEBHOOK_DELIVERY_REPOSITORY),
    emails: app.get(EMAIL_NOTIFICATION_REPOSITORY),
    queries: app.get(NOTIFICATIONS_QUERIES),
    run: (work) => uow.run(work),
  }));

  it('should keep the webhook secret encrypted and bound to its row', async () => {
    const subscription = aSubscription();
    await uow.run(() =>
      app.get<WebhookSubscriptionRepository>(WEBHOOK_SUBSCRIPTION_REPOSITORY).save(subscription),
    );

    const [row] = await app
      .get(DataSource)
      .query<{ secret_encrypted: string }[]>(
        'SELECT secret_encrypted FROM notifications.webhook_subscriptions WHERE id = $1',
        [subscription.id],
      );

    expect(row?.secret_encrypted).not.toContain(SECRET.slice(-12));
  });

  it('should keep the replaced secret encrypted and bound to its own column', async () => {
    const repository = app.get<WebhookSubscriptionRepository>(WEBHOOK_SUBSCRIPTION_REPOSITORY);
    const subscription = aSubscription();
    await uow.run(() => repository.save(subscription));
    const loaded = await uow.run(() => repository.findById(subscription.id));
    loaded?.reconfigure(subscription.url, 'whsec_rotated_secret_0123456789', LATER);
    if (loaded) await uow.run(() => repository.save(loaded));
    const db = app.get(DataSource);

    const [row] = await db.query<{ previous_secret_encrypted: string; secret_encrypted: string }[]>(
      `SELECT previous_secret_encrypted, secret_encrypted
         FROM notifications.webhook_subscriptions WHERE id = $1`,
      [subscription.id],
    );
    // The current secret's ciphertext moved into the previous column no longer decrypts there.
    await db.query(
      `UPDATE notifications.webhook_subscriptions SET previous_secret_encrypted = secret_encrypted
        WHERE id = $1`,
      [subscription.id],
    );

    expect(row?.previous_secret_encrypted).toMatch(/^v2\./);
    expect(row?.previous_secret_encrypted).not.toContain(SECRET.slice(-12));
    await expect(uow.run(() => repository.findById(subscription.id))).rejects.toThrow(
      /could not be decrypted/,
    );
  });
});
