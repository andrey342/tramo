import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { CLS_ID, ClsService } from 'nestjs-cls';
import { DataSource } from 'typeorm';

import {
  EVENT_BUS,
  type EventBus,
  IDEMPOTENCY_STORE,
  type IdempotencyStore,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { type DomainEvent } from '@shared/domain';

import { ConfigModule } from '../config';
import { RequestContextModule } from '../context';
import { DatabaseModule } from '../database';

import { MessagingModule } from './messaging.module';
import { EventPublishedOutsideUnitOfWorkError } from './outbox-event-bus';

const event = (aggregateId: string): DomainEvent => ({
  eventType: 'ProbeHappened',
  aggregateType: 'Probe',
  aggregateId,
  occurredAt: new Date('2026-10-09T12:00:00Z'),
  payload: { amountCents: 750_000, tags: ['a', 'b'] },
});

describe('Unit of work and outbox (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let bus: EventBus;
  let store: IdempotencyStore;
  let cls: ClsService;
  let db: DataSource;
  let txHost: TransactionHost<TransactionalAdapterTypeOrm>;
  const insertProbe = (id: string): Promise<unknown> =>
    txHost.tx.query('INSERT INTO public.uow_probe (id) VALUES ($1)', [id]);
  const probeExists = async (id: string): Promise<boolean> => {
    const rows: unknown[] = await db.query('SELECT id FROM public.uow_probe WHERE id = $1', [id]);
    return rows.length === 1;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        RequestContextModule,
        DatabaseModule.forRoot('tramo-int-tests'),
        MessagingModule,
      ],
    }).compile();
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    bus = app.get(EVENT_BUS);
    store = app.get(IDEMPOTENCY_STORE);
    cls = app.get(ClsService);
    db = app.get(DataSource);
    txHost = app.get(TransactionHost);
    await db.query('CREATE TABLE IF NOT EXISTS public.uow_probe (id text PRIMARY KEY)');
  });

  afterAll(async () => {
    await db.query('DROP TABLE IF EXISTS public.uow_probe');
    await app.close();
  });

  const outboxFor = (aggregateId: string): Promise<Record<string, unknown>[]> =>
    db.query(
      'SELECT event_type, payload, occurred_at, correlation_id, published_at FROM shared.outbox_messages WHERE aggregate_id = $1',
      [aggregateId],
    );

  it('should store events with the correlation id of the current context', async () => {
    await cls.run(async () => {
      cls.set(CLS_ID, 'req-123');
      await uow.run(() => bus.publish([event('agg-1')]));
      const [row] = await outboxFor('agg-1');

      expect(row).toMatchObject({
        event_type: 'ProbeHappened',
        payload: { amountCents: 750_000, tags: ['a', 'b'] },
        correlation_id: 'req-123',
        published_at: null,
      });
    });
  });

  it('should roll back state changes and their events together', async () => {
    const failing = uow.run(async () => {
      await insertProbe('agg-2');
      await bus.publish([event('agg-2')]);
      throw new Error('handler failed after publishing');
    });

    await expect(failing).rejects.toThrow('handler failed after publishing');
    expect(await probeExists('agg-2')).toBe(false);
    expect(await outboxFor('agg-2')).toEqual([]);
  });

  it('should commit writes made through the transaction with their events', async () => {
    await uow.run(async () => {
      await insertProbe('agg-3');
      await bus.publish([event('agg-3')]);
    });

    expect(await probeExists('agg-3')).toBe(true);
    expect(await outboxFor('agg-3')).toHaveLength(1);
  });

  it('should refuse to publish outside a unit of work', async () => {
    await expect(bus.publish([event('agg-4')])).rejects.toThrow(
      EventPublishedOutsideUnitOfWorkError,
    );
  });

  it('should let a consumer claim an event once', async () => {
    const first = await uow.run(() => store.claim('evt-1', 'notifications.welcome'));
    const second = await uow.run(() => store.claim('evt-1', 'notifications.welcome'));
    const otherConsumer = await uow.run(() => store.claim('evt-1', 'reporting.funnel'));

    expect([first, second, otherConsumer]).toEqual([true, false, true]);
  });

  it('should release the claim when the consumer work fails', async () => {
    await expect(
      uow.run(async () => {
        await store.claim('evt-2', 'notifications.welcome');
        throw new Error('smtp down');
      }),
    ).rejects.toThrow('smtp down');

    expect(await uow.run(() => store.claim('evt-2', 'notifications.welcome'))).toBe(true);
  });
});
