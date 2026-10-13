import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { RebuildProjectionsCommand } from '@modules/reporting/application/commands/rebuild-projections.command';
import { GetCenterDashboardQuery } from '@modules/reporting/application/queries/get-center-dashboard.query';
import { ReportingModule } from '@modules/reporting/reporting.module';
import {
  EVENT_BUS,
  type EventBus,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';

import { aPortfolio } from '../factories/reporting';
import { eventually } from '../helpers/eventually';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

// Events of origination, lending and billing reach the read models through the outbox and the
// reporting consumers; then the read models are thrown away and rebuilt from the outbox, and
// answer the same.
describe('reporting flow (integration)', () => {
  let app: INestApplicationContext;
  let publisher: OutboxPublisher;
  let queries: QueryBus;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        ReportingModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    publisher = app.get(OutboxPublisher);
    queries = app.get(QueryBus);
    await app
      .get(DataSource)
      .query('UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL');
  });

  afterAll(async () => {
    await app.close();
  });

  it('should project events as they happen, and rebuild the same figures from the outbox', async () => {
    const portfolio = aPortfolio();
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(() =>
      app.get<EventBus>(EVENT_BUS).publish(
        portfolio.events.map((event) => ({
          eventType: event.eventType,
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          occurredAt: new Date(event.occurredAt),
          payload: event.payload,
        })),
      ),
    );
    const dashboard = () => queries.execute(new GetCenterDashboardQuery(OPS, portfolio.centerId));

    let live = await dashboard();
    await eventually(
      async () => {
        await publisher.publishBatch();
        live = await dashboard();
        expect(live).toMatchObject({
          applications: { offerAccepted: 1, rejected: 1, needsReview: 1 },
          contracts: { active: 1, inArrears: 1 },
          disbursedCents: 7_125_00,
          collectedCents: 337_50,
          outstandingCents: 337_50,
        });
      },
      { timeoutMs: 30_000 },
    );

    const applied = await app.get(CommandBus).execute(new RebuildProjectionsCommand());
    const rebuilt = await dashboard();

    expect(applied).toBeGreaterThanOrEqual(portfolio.events.length);
    expect({ ...rebuilt, generatedAt: null }).toEqual({ ...live, generatedAt: null });
  }, 60_000);
});
