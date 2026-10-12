import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { uuidv7 } from 'uuidv7';

import { CatalogModule } from '@modules/catalog/catalog.module';
import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '@modules/catalog/domain';
import { USER_REPOSITORY, type UserRepository } from '@modules/iam/domain';
import { IamModule } from '@modules/iam/iam.module';
import { LendingEvents } from '@modules/lending/domain/events/lending-events';
import { ConfigureWebhookCommand } from '@modules/notifications/application/commands/configure-webhook.command';
import { DeliverWebhookCommand } from '@modules/notifications/application/commands/deliver-webhook.command';
import { SendEmailCommand } from '@modules/notifications/application/commands/send-email.command';
import { EMAIL_SENDER } from '@modules/notifications/application/ports/notifications-ports';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import {
  EVENT_BUS,
  type EventBus,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';
import { verifyWebhook } from '@shared/infrastructure/http';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';

import { anActiveTrainingCenter } from '../factories/catalog';
import { aCenterAdmin } from '../factories/iam';
import { FakeEmailSender } from '../fakes/notifications';
import { eventually } from '../helpers/eventually';

interface Received {
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
}

// An event of lending reaches the center by email (to its admins, looked up in iam) and by its
// webhook (signed with the secret it was given). The outbox is published by hand; the jobs that
// send are run directly, the email to a fake server and the webhook to a real local endpoint.
describe('notifications flow (integration)', () => {
  let app: INestApplicationContext;
  let commands: CommandBus;
  let publisher: OutboxPublisher;
  let db: DataSource;
  const emails = new FakeEmailSender();
  let endpoint: Server;
  let endpointUrl: string;
  const received: Received[] = [];

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    endpoint = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        response.writeHead(204).end();
      });
    });
    await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
    endpointUrl = `http://127.0.0.1:${String((endpoint.address() as AddressInfo).port)}/tramo`;
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        IamModule,
        CatalogModule,
        NotificationsModule,
      ],
    })
      .overrideProvider(EMAIL_SENDER)
      .useValue(emails)
      .compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    commands = app.get(CommandBus);
    publisher = app.get(OutboxPublisher);
    db = app.get(DataSource);
    await db.query(
      'UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL',
    );
  });

  afterAll(async () => {
    await app.close();
    await new Promise((resolve) => endpoint.close(resolve));
  });

  async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
    let found: T | undefined;
    await eventually(
      async () => {
        await publisher.publishBatch();
        found = await read();
        expect(found).toBeDefined();
      },
      { timeoutMs: 30_000 },
    );
    return found as T;
  }

  it('should email the center admins and post the signed webhook when a disbursement settles', async () => {
    const center = anActiveTrainingCenter();
    const admin = aCenterAdmin({ centerId: center.id });
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY).save(center);
      await app.get<UserRepository>(USER_REPOSITORY).save(admin);
    });
    const actor: Principal = {
      kind: 'user',
      userId: admin.id,
      roles: ['center_admin'],
      centerId: center.id,
    };
    const { secret } = await commands.execute(
      new ConfigureWebhookCommand(actor, center.id, endpointUrl),
    );
    const [contractId, disbursementId] = [uuidv7(), uuidv7()];
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(() =>
      app.get<EventBus>(EVENT_BUS).publish([
        {
          eventType: LendingEvents.DisbursementSettled,
          aggregateType: 'Disbursement',
          aggregateId: disbursementId,
          occurredAt: new Date(),
          payload: { disbursementId, contractId, centerId: center.id, amountCents: 7_125_00 },
        },
      ]),
    );

    const email = await until(async () => {
      const [row] = await db.query<{ id: string }[]>(
        `SELECT id FROM notifications.notification_log WHERE reference = $1`,
        [contractId],
      );
      return row;
    });
    const delivery = await until(async () => {
      const [row] = await db.query<{ id: string }[]>(
        `SELECT id FROM notifications.webhook_deliveries WHERE center_id = $1`,
        [center.id],
      );
      return row;
    });
    await commands.execute(new SendEmailCommand(email.id, false));
    await commands.execute(new DeliverWebhookCommand(delivery.id, 1, false));

    expect(emails.sent).toEqual([
      expect.objectContaining({
        to: admin.email.value,
        subject: 'Tramo has paid 7125.00 EUR',
        reference: contractId,
      }),
    ]);
    const [post] = received;
    const signature = post?.headers['x-tramo-signature'];
    expect(
      verifyWebhook(
        secret,
        typeof signature === 'string' ? signature : undefined,
        Buffer.from(post?.body ?? ''),
        new Date(),
      ),
    ).toEqual({ valid: true });
    expect(JSON.parse(post?.body ?? '{}')).toMatchObject({
      event: 'disbursement.settled',
      data: { disbursementId, contractId, amountCents: 7_125_00 },
    });
    const [stored] = await db.query<{ status: string }[]>(
      'SELECT status FROM notifications.webhook_deliveries WHERE id = $1',
      [delivery.id],
    );
    expect(stored?.status).toBe('delivered');
  }, 60_000);
});
