import { uuidv7 } from 'uuidv7';

import { BillingEvents } from '@modules/billing/domain/events/billing-events';
import { LendingEvents } from '@modules/lending/domain/events/lending-events';
import { OriginationEvents } from '@modules/origination/domain/events/origination-events';
import { type Principal } from '@shared/application';
import { type ApiKeyScope, EntityNotFoundError, FixedClock } from '@shared/domain';

import { aPortfolio, anEvent, NOW } from '../../../../test/factories/reporting';
import {
  FakePrograms,
  FakeProgramScores,
  FakeQueueHealth,
  FakeRebuildJobs,
  InMemoryEventHistory,
  InMemoryReportingStore,
} from '../../../../test/fakes/reporting';
import { InlineUnitOfWork } from '../../../../test/fakes/shared';
import { ReportingAccessDeniedError } from '../domain';

import { ProjectEventCommand, ProjectEventHandler } from './commands/project-event.command';
import { RebuildProjectionsHandler } from './commands/rebuild-projections.command';
import { RequestRebuildCommand, RequestRebuildHandler } from './commands/request-rebuild.command';
import {
  GetCenterDashboardHandler,
  GetCenterDashboardQuery,
} from './queries/get-center-dashboard.query';
import { GetOpsOverviewHandler, GetOpsOverviewQuery } from './queries/get-ops-overview.query';
import {
  GetProgramPerformanceHandler,
  GetProgramPerformanceQuery,
} from './queries/get-program-performance.query';
import { ReportingProjector } from './reporting-projector';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

function setup() {
  const clock = new FixedClock(NOW);
  const uow = new InlineUnitOfWork();
  const store = new InMemoryReportingStore();
  const history = new InMemoryEventHistory();
  const programs = new FakePrograms();
  const scores = new FakeProgramScores();
  const queues = new FakeQueueHealth();
  const jobs = new FakeRebuildJobs();
  const projector = new ReportingProjector(store);
  const project = new ProjectEventHandler(uow, projector);
  return {
    store,
    history,
    programs,
    scores,
    queues,
    jobs,
    // Live: each event through its consumer, and into the history the rebuild reads.
    happened: async (...events: Parameters<typeof history.events.push>) => {
      for (const event of events) {
        history.events.push(event);
        await project.execute(new ProjectEventCommand(event));
      }
    },
    rebuild: new RebuildProjectionsHandler(uow, store, history, projector),
    request: new RequestRebuildHandler(jobs),
    dashboard: new GetCenterDashboardHandler(store, clock),
    performance: new GetProgramPerformanceHandler(store, programs, scores, clock),
    overview: new GetOpsOverviewHandler(store, queues, clock),
  };
}

const adminOf = (centerId: string): Principal => ({
  kind: 'user',
  userId: uuidv7(),
  roles: ['center_admin'],
  centerId,
});

describe('reporting use cases', () => {
  it('should show a center its funnel, its contracts and its money from what happened', async () => {
    const t = setup();
    const portfolio = aPortfolio();
    await t.happened(...portfolio.events);

    const dashboard = await t.dashboard.execute(
      new GetCenterDashboardQuery(adminOf(portfolio.centerId), portfolio.centerId),
    );

    expect(dashboard).toMatchObject({
      centerId: portfolio.centerId,
      applications: {
        submitted: 0,
        approved: 0,
        needsReview: 1,
        rejected: 1,
        offerAccepted: 1,
        cancelled: 0,
        expired: 0,
      },
      contracts: { active: 1, inArrears: 1, completed: 0, defaulted: 0, cancelled: 0 },
      disbursedCents: 7_125_00,
      collectedCents: 337_50,
      outstandingCents: 337_50,
      writtenOffCents: 0,
      // 1 of the 2 contracts being repaid is in arrears.
      delinquencyRateBasisPoints: 5_000,
      generatedAt: NOW,
    });
    expect(dashboard.byProduct.map((product) => product.contracts)).toEqual([
      { active: 1, inArrears: 0, completed: 0, defaulted: 0, cancelled: 0 },
      { active: 0, inArrears: 1, completed: 0, defaulted: 0, cancelled: 0 },
    ]);
  });

  // The return reaches the consumer before the payment it undoes, and still wins: it is newer.
  it('should count a payment as outstanding again when the bank returns it', async () => {
    const t = setup();
    const [centerId, contractId, chargeId] = [uuidv7(), uuidv7(), uuidv7()];
    const charge = { chargeId, contractId, studentId: uuidv7(), centerId, kind: 'installment' };
    const created = anEvent(BillingEvents.ChargeCreated, {
      ...charge,
      amountCents: 337_50,
      dueDate: '2026-11-12',
    });
    const paid = anEvent(BillingEvents.ChargePaid, {
      ...charge,
      installmentNumber: 1,
      amountCents: 337_50,
      paidAt: NOW.toISOString(),
    });
    const returned = anEvent(BillingEvents.ChargeReturned, {
      ...charge,
      installmentNumber: 1,
      amountCents: 337_50,
      attempt: 1,
      reason: 'MD06',
      dueDate: '2026-11-12',
      returnedAt: NOW.toISOString(),
    });

    await t.happened(created, returned, paid);

    const dashboard = await t.dashboard.execute(new GetCenterDashboardQuery(OPS, centerId));
    expect(dashboard).toMatchObject({ collectedCents: 0, outstandingCents: 337_50 });
  });

  it('should keep an offer accepted in the funnel when its contract is cancelled later', async () => {
    const t = setup();
    const portfolio = aPortfolio();
    const accepted = portfolio.events.find(
      (event) => event.eventType === OriginationEvents.OfferAccepted,
    );
    await t.happened(
      ...portfolio.events,
      anEvent(OriginationEvents.ApplicationWithdrawn, {
        applicationId: accepted?.payload.applicationId ?? null,
        centerId: portfolio.centerId,
      }),
    );

    const dashboard = await t.dashboard.execute(
      new GetCenterDashboardQuery(adminOf(portfolio.centerId), portfolio.centerId),
    );

    expect(dashboard.applications.offerAccepted).toBe(1);
  });

  it('should keep a center to its own portfolio, and let its keys read it with the scope', async () => {
    const t = setup();
    const centerId = uuidv7();
    const key = (scopes: readonly ApiKeyScope[]): Principal => ({
      kind: 'api_key',
      apiKeyId: uuidv7(),
      centerId,
      scopes,
    });
    const student: Principal = { kind: 'user', userId: 's', roles: ['student'], centerId: null };

    await expect(
      t.dashboard.execute(new GetCenterDashboardQuery(adminOf(uuidv7()), centerId)),
    ).rejects.toThrow(ReportingAccessDeniedError);
    await expect(
      t.dashboard.execute(new GetCenterDashboardQuery(student, centerId)),
    ).rejects.toThrow(ReportingAccessDeniedError);
    await expect(
      t.dashboard.execute(new GetCenterDashboardQuery(key(['programs:read']), centerId)),
    ).rejects.toThrow(ReportingAccessDeniedError);
    expect(
      (await t.dashboard.execute(new GetCenterDashboardQuery(key(['portfolio:read']), centerId)))
        .delinquencyRateBasisPoints,
    ).toBeNull();
    expect((await t.dashboard.execute(new GetCenterDashboardQuery(OPS, centerId))).centerId).toBe(
      centerId,
    );
  });

  // 3 applications for 7,500, 4,200 and 9,900: a mean ticket of 7,200. 1 approved, 1 rejected.
  // Ten applicants scored 70 to 79: a mean of 74.5, shown in its band of five, 75.
  it('should show how a program converts, with the scores origination aggregates', async () => {
    const t = setup();
    const portfolio = aPortfolio();
    await t.happened(...portfolio.events);
    t.programs.centers.set(portfolio.programId, portfolio.centerId);
    t.scores.scores.set(
      portfolio.programId,
      Array.from({ length: 10 }, (_, index) => 70 + index),
    );

    const performance = await t.performance.execute(
      new GetProgramPerformanceQuery(OPS, portfolio.centerId, portfolio.programId),
    );

    expect(performance).toEqual({
      centerId: portfolio.centerId,
      programId: portfolio.programId,
      applications: 3,
      approved: 1,
      rejected: 1,
      approvalRateBasisPoints: 5_000,
      averageTicketCents: 7_200_00,
      scoredApplications: 10,
      averageScore: 75,
      generatedAt: NOW,
    });
    await expect(
      t.performance.execute(new GetProgramPerformanceQuery(OPS, uuidv7(), portfolio.programId)),
    ).rejects.toThrow(EntityNotFoundError);
  });

  // Origination gives no mean below ten scored applicants: it would say too much about each.
  it('should show no mean score when fewer than ten applicants were scored', async () => {
    const t = setup();
    const portfolio = aPortfolio();
    await t.happened(...portfolio.events);
    t.programs.centers.set(portfolio.programId, portfolio.centerId);
    t.scores.scores.set(portfolio.programId, [70, 81]);

    const performance = await t.performance.execute(
      new GetProgramPerformanceQuery(OPS, portfolio.centerId, portfolio.programId),
    );

    expect(performance).toMatchObject({ scoredApplications: 2, averageScore: null });
  });

  it('should show operations what needs them today, for staff only', async () => {
    const t = setup();
    await t.happened(...aPortfolio().events);
    t.queues.letters = 2;

    const overview = await t.overview.execute(new GetOpsOverviewQuery(OPS));

    expect(overview).toEqual({
      reviewQueue: 1,
      failedChargesToday: 1,
      pendingDisbursements: 0,
      failedDisbursements: 0,
      contractsInArrears: 1,
      deadLetters: 2,
      generatedAt: NOW,
    });
    await expect(t.overview.execute(new GetOpsOverviewQuery(adminOf(uuidv7())))).rejects.toThrow(
      ReportingAccessDeniedError,
    );
  });

  // Failed for good and cancelled with its contract: nothing left for operations to do about it.
  it('should stop counting a failed transfer once it is cancelled with its contract', async () => {
    const t = setup();
    const transfer = { disbursementId: uuidv7(), contractId: uuidv7(), centerId: uuidv7() };
    await t.happened(
      anEvent(LendingEvents.DisbursementRequested, { ...transfer, amountCents: 7_125_00 }),
      anEvent(LendingEvents.DisbursementFailed, { ...transfer, reason: 'center_not_active' }),
    );
    const before = await t.overview.execute(new GetOpsOverviewQuery(OPS));

    await t.happened(anEvent(LendingEvents.DisbursementCancelled, { ...transfer, attempt: 1 }));
    const after = await t.overview.execute(new GetOpsOverviewQuery(OPS));

    expect([before.failedDisbursements, after.failedDisbursements]).toEqual([1, 0]);
    expect(after.pendingDisbursements).toBe(0);
  });

  it('should still answer the overview, without the dead letters, when the queue cannot be read', async () => {
    const t = setup();
    await t.happened(...aPortfolio().events);
    t.queues.letters = null;

    const overview = await t.overview.execute(new GetOpsOverviewQuery(OPS));

    expect(overview).toMatchObject({ reviewQueue: 1, contractsInArrears: 1, deadLetters: null });
  });

  // The read models are disposable: thrown away and replayed, they answer the same.
  it('should rebuild the same read models from the history', async () => {
    const t = setup();
    const portfolio = aPortfolio();
    await t.happened(...portfolio.events);
    const live = await t.dashboard.execute(new GetCenterDashboardQuery(OPS, portfolio.centerId));
    await t.store.beginRebuild();

    const applied = await t.rebuild.execute();
    const rebuilt = await t.dashboard.execute(new GetCenterDashboardQuery(OPS, portfolio.centerId));

    expect(applied).toBe(portfolio.events.length);
    expect(rebuilt).toEqual(live);
  });

  // Consumers run one job per event: the same events in any order, some twice, give the same
  // figures.
  it('should end with the same figures whatever the order of the events, and their repeats', async () => {
    const inOrder = setup();
    const shuffled = setup();
    const portfolio = aPortfolio();
    await inOrder.happened(...portfolio.events);
    const reversed = [...portfolio.events].reverse();
    await shuffled.happened(...reversed, ...portfolio.events.filter((_, index) => index % 2 === 0));

    const query = new GetCenterDashboardQuery(OPS, portfolio.centerId);
    expect(await shuffled.dashboard.execute(query)).toEqual(await inOrder.dashboard.execute(query));
    expect(await shuffled.overview.execute(new GetOpsOverviewQuery(OPS))).toEqual(
      await inOrder.overview.execute(new GetOpsOverviewQuery(OPS)),
    );
  });

  it('should ignore events the read models do not follow', async () => {
    const t = setup();

    await t.happened(anEvent('StudentRegistered', { userId: 'u', email: 'x@example.com' }));

    expect(t.store.applications.size + t.store.contracts.size).toBe(0);
  });

  it('should let staff ask for one rebuild at a time', async () => {
    const t = setup();

    const first = await t.request.execute(new RequestRebuildCommand(OPS));
    const second = await t.request.execute(new RequestRebuildCommand(OPS));

    expect([first, second]).toEqual([{ queued: true }, { queued: false }]);
    expect(t.jobs.requests).toEqual(['ops-1']);
    await expect(t.request.execute(new RequestRebuildCommand(adminOf(uuidv7())))).rejects.toThrow(
      ReportingAccessDeniedError,
    );
  });
});
