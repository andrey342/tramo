import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Queue } from 'bullmq';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';

import {
  EVENT_BUS,
  type EventBus,
  type EventHandler,
  EventSubscriber,
  type IntegrationEvent,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';

import { eventually } from '../../../../test/helpers/eventually';
import { ClockModule } from '../clock/system-clock';
import { ConfigModule } from '../config';
import { RequestContextModule } from '../context';
import { DatabaseModule } from '../database';
import { QueueNames, QueuesModule } from '../queues';

import { MessagingWorkerModule } from './messaging-worker.module';
import { MessagingModule } from './messaging.module';
import { OutboxEnqueueTimeoutError, OutboxPublisher } from './outbox-publisher';

const received: IntegrationEvent[] = [];
let failuresSeen = 0;

@Injectable()
@EventSubscriber({ event: 'DeliveryProbed', consumer: 'reporting.delivery-probe' })
class RecordingHandler implements EventHandler {
  handle(event: IntegrationEvent): Promise<void> {
    received.push(event);
    return Promise.resolve();
  }
}

@Injectable()
@EventSubscriber({ event: 'DeliveryBroke', consumer: 'notifications.always-fails' })
class FailingHandler implements EventHandler {
  handle(): Promise<void> {
    failuresSeen += 1;
    return Promise.reject(new Error('smtp is down'));
  }
}

describe('Event delivery through the outbox (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let bus: EventBus;
  let publisher: OutboxPublisher;
  let cls: ClsService;
  let db: DataSource;

  const publish = (eventType: string, aggregateId: string): Promise<void> =>
    uow.run(() =>
      bus.publish([
        {
          eventType,
          aggregateType: 'Probe',
          aggregateId,
          occurredAt: new Date('2026-10-09T12:00:00Z'),
          payload: { aggregateId },
        },
      ]),
    );

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    process.env.OUTBOX_BATCH_SIZE = '10';
    process.env.OUTBOX_ENQUEUE_TIMEOUT_MS = '300';
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        ClockModule,
        RequestContextModule,
        DatabaseModule.forRoot('tramo-int-tests'),
        MessagingModule,
        QueuesModule,
        MessagingWorkerModule,
      ],
      providers: [RecordingHandler, FailingHandler],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    bus = app.get(EVENT_BUS);
    publisher = app.get(OutboxPublisher);
    cls = app.get(ClsService);
    db = app.get(DataSource);
    // Other suites leave unpublished rows behind; this suite counts its own rows only.
    await db.query(
      'UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('should deliver a committed event to its subscriber with the original correlation id', async () => {
    await cls.run(async () => {
      cls.set(CLS_ID, 'req-delivery-1');
      await publish('DeliveryProbed', 'probe-1');
    });

    expect(await publisher.publishBatch()).toBe(1);

    await eventually(() => {
      expect(received.find((event) => event.aggregateId === 'probe-1')).toMatchObject({
        eventType: 'DeliveryProbed',
        aggregateType: 'Probe',
        correlationId: 'req-delivery-1',
        payload: { aggregateId: 'probe-1' },
        occurredAt: '2026-10-09T12:00:00.000Z',
      });
    });
    const [row] = await db.query<{ published_at: Date | null }[]>(
      "SELECT published_at FROM shared.outbox_messages WHERE aggregate_id = 'probe-1'",
    );
    expect(row?.published_at).toBeInstanceOf(Date);
  });

  it('should run a consumer once when the same event is delivered twice', async () => {
    await publish('DeliveryProbed', 'probe-2');
    await publisher.publishBatch();
    await eventually(() => {
      expect(received.filter((event) => event.aggregateId === 'probe-2')).toHaveLength(1);
    });
    const event = received.find((item) => item.aggregateId === 'probe-2');

    const queue = app.get<Queue>(getQueueToken('events.reporting'));
    const redelivery = await queue.add('reporting.delivery-probe', event, {
      jobId: `${event?.eventId ?? ''}.redelivery`,
    });
    await eventually(async () => {
      expect(await redelivery.isCompleted()).toBe(true);
    });

    expect(received.filter((item) => item.aggregateId === 'probe-2')).toHaveLength(1);
  });

  it('should roll a batch back instead of waiting while Redis does not answer', async () => {
    const queue = app.get<Queue>(getQueueToken('events.reporting'));
    const stalled = jest
      .spyOn(queue, 'addBulk')
      .mockImplementation(() => new Promise<never>(() => undefined));
    await publish('DeliveryProbed', 'probe-stalled');

    await expect(publisher.publishBatch()).rejects.toThrow(OutboxEnqueueTimeoutError);
    const [pending] = await db.query<{ published_at: Date | null; last_error: string | null }[]>(
      `SELECT published_at, last_error FROM shared.outbox_messages WHERE aggregate_id = 'probe-stalled'`,
    );
    expect(pending?.published_at).toBeNull();
    expect(pending?.last_error).toContain('did not accept');

    stalled.mockRestore();
    expect(await publisher.publishBatch()).toBe(1);
  });

  it('should mark events without subscribers as published', async () => {
    await publish('NobodyListens', 'probe-3');

    expect(await publisher.publishBatch()).toBe(1);
    expect(await publisher.publishBatch()).toBe(0);
  });

  it('should hand each row to exactly one of several concurrent publishers', async () => {
    for (let index = 0; index < 25; index += 1) {
      await publish('NobodyListens', `bulk-${index}`);
    }

    const counts = await Promise.all([
      publisher.publishBatch(),
      publisher.publishBatch(),
      publisher.publishBatch(),
    ]);

    expect(counts.reduce((sum, count) => sum + count, 0)).toBe(25);
  });

  it('should move a delivery to the dead-letter queue after its last attempt', async () => {
    const queue = app.get<Queue>(getQueueToken('events.notifications'));
    await queue.add(
      'notifications.always-fails',
      {
        eventId: '01999999-0000-7000-8000-000000000001',
        eventType: 'DeliveryBroke',
        aggregateType: 'Probe',
        aggregateId: 'probe-dlq',
        occurredAt: '2026-10-09T12:00:00.000Z',
        correlationId: 'req-dlq',
        payload: {},
      } satisfies IntegrationEvent,
      { jobId: 'probe-dlq', attempts: 2, backoff: 0 },
    );

    const deadLetters = app.get<Queue>(getQueueToken(QueueNames.DEAD_LETTER));
    await eventually(async () => {
      const letters = await deadLetters.getJobs(['waiting']);
      const letter = letters.find((job) => job.id?.startsWith('events.notifications.probe-dlq.'));
      expect(letter?.data).toMatchObject({
        queue: 'events.notifications',
        jobName: 'notifications.always-fails',
        failedReason: 'smtp is down',
        attemptsMade: 2,
      });
    });
    expect(failuresSeen).toBe(2);
  });
});
