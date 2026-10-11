import { type AuditChanges, type Principal } from '@shared/application';
import { ConcurrentModificationError, FixedClock, NationalId, unwrap } from '@shared/domain';

import {
  aCompleteProfile,
  aDraftApplication,
  aSubmittedApplication,
  NOW,
} from '../../../../test/factories/origination';
import {
  FakeCreditBureau,
  FakeEmploymentHistoryProvider,
  FakeKycProvider,
  InMemoryFinancingApplicationRepository,
  InMemoryRiskPolicyRepository,
} from '../../../../test/fakes/origination';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  ApplicationAccessDeniedError,
  EXPIRY_DAYS,
  type FinancingApplication,
  InvalidRiskPolicyError,
  OriginationEvents,
  RiskPolicy,
} from '../domain';

import {
  ExpireApplicationCommand,
  ExpireApplicationHandler,
} from './commands/expire-application.command';
import {
  ReviseRiskPolicyCommand,
  ReviseRiskPolicyHandler,
} from './commands/revise-risk-policy.command';
import {
  RunVerificationCommand,
  RunVerificationHandler,
} from './commands/run-verification.command';
import {
  ScoreApplicationCommand,
  ScoreApplicationHandler,
} from './commands/score-application.command';
import {
  StartVerificationCommand,
  StartVerificationHandler,
} from './commands/start-verification.command';
import {
  GetCurrentRiskPolicyHandler,
  GetCurrentRiskPolicyQuery,
} from './queries/get-current-risk-policy.query';

const DAY_MS = 24 * 60 * 60 * 1000;
const ADMIN: Principal = { kind: 'user', userId: 'admin-1', roles: ['admin'], centerId: null };
const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

// Saves fail with a lost optimistic lock this many times before going through.
class ContendedRepository extends InMemoryFinancingApplicationRepository {
  conflicts = 0;

  override async save(application: FinancingApplication): Promise<void> {
    if (this.conflicts > 0) {
      this.conflicts -= 1;
      throw new ConcurrentModificationError('FinancingApplication', application.id);
    }
    await super.save(application);
  }
}

function setup() {
  const clock = new FixedClock(NOW);
  const uow = new InlineUnitOfWork();
  const events = new RecordingEventBus();
  const applications = new ContendedRepository(events);
  const policies = new InMemoryRiskPolicyRepository([RiskPolicy.initial(NOW)]);
  const kyc = new FakeKycProvider();
  const employment = new FakeEmploymentHistoryProvider();
  const bureau = new FakeCreditBureau();
  const audited: AuditChanges[] = [];
  return {
    clock,
    events,
    applications,
    policies,
    employment,
    audited,
    startVerification: new StartVerificationHandler(uow, applications, clock),
    run: new RunVerificationHandler(uow, applications, kyc, employment, bureau, clock),
    score: new ScoreApplicationHandler(uow, applications, policies, clock),
    expire: new ExpireApplicationHandler(uow, applications, clock),
    revise: new ReviseRiskPolicyHandler(
      uow,
      policies,
      { describeChanges: (changes) => audited.push(changes) },
      clock,
    ),
    currentPolicy: new GetCurrentRiskPolicyHandler(policies),
  };
}

type Kit = ReturnType<typeof setup>;

async function verifyAll(t: Kit, id: string): Promise<void> {
  for (const type of ['kyc', 'employment', 'bureau'] as const) {
    await t.run.execute(new RunVerificationCommand(id, type));
  }
}

async function saved(t: Kit, application: FinancingApplication): Promise<string> {
  await t.applications.save(application);
  return application.id;
}

describe('verification and scoring', () => {
  it('should verify a submitted application, move it to scoring and approve a good applicant', async () => {
    const t = setup();
    const id = await saved(t, aSubmittedApplication());

    await t.startVerification.execute(new StartVerificationCommand(id));
    await verifyAll(t, id);
    expect((await t.applications.findById(id))?.status).toBe('scoring');
    await t.score.execute(new ScoreApplicationCommand(id));

    const application = await t.applications.findById(id);
    expect(application?.status).toBe('approved');
    expect(application?.decision?.policyVersion).toBe(1);
    expect(t.events.ofType(OriginationEvents.VerificationCompleted)).toHaveLength(3);
    expect(t.events.ofType(OriginationEvents.ApplicationApproved)).toHaveLength(1);
  });

  it('should reject an applicant in a default registry', async () => {
    const t = setup();
    // 12345677 mod 23 = 13, letter J; ending in 7, the bureau lists it.
    const id = await saved(
      t,
      aSubmittedApplication({
        profile: aCompleteProfile({ nationalId: unwrap(NationalId.create('12345677J')) }),
      }),
    );

    await verifyAll(t, id);
    await t.score.execute(new ScoreApplicationCommand(id));

    const application = await t.applications.findById(id);
    expect(application?.status).toBe('rejected');
    expect(application?.decision?.hardRulesBroken).toEqual(['default_registry']);
  });

  it('should score with the policy in force at the time', async () => {
    const t = setup();
    const id = await saved(t, aSubmittedApplication());
    await t.revise.execute(
      new ReviseRiskPolicyCommand(ADMIN, { approveThreshold: 95, reviewThreshold: 90 }),
    );

    await verifyAll(t, id);
    await t.score.execute(new ScoreApplicationCommand(id));

    const application = await t.applications.findById(id);
    expect(application?.decision?.policyVersion).toBe(2);
    expect(application?.status).toBe('rejected');
  });

  it('should ignore repeated work: a second check, a second start, a second score', async () => {
    const t = setup();
    const id = await saved(t, aSubmittedApplication());

    await t.run.execute(new RunVerificationCommand(id, 'employment'));
    await t.run.execute(new RunVerificationCommand(id, 'employment'));
    await t.startVerification.execute(new StartVerificationCommand(id));
    await t.score.execute(new ScoreApplicationCommand(id));

    expect(t.employment.asked).toHaveLength(1);
    expect((await t.applications.findById(id))?.status).toBe('verifying');
  });

  it('should not ask providers about an application that is no longer waiting for them', async () => {
    const t = setup();
    const application = aSubmittedApplication();
    application.cancel(NOW);
    const id = await saved(t, application);

    await t.run.execute(new RunVerificationCommand(id, 'employment'));
    await t.run.execute(new RunVerificationCommand('missing', 'employment'));
    await t.score.execute(new ScoreApplicationCommand('missing'));

    expect(t.employment.asked).toEqual([]);
  });

  it('should record the answer again when another check saved first, without asking twice', async () => {
    const t = setup();
    const id = await saved(t, aSubmittedApplication());
    t.applications.conflicts = 2;

    await t.run.execute(new RunVerificationCommand(id, 'employment'));

    expect(t.employment.asked).toHaveLength(1);
    expect((await t.applications.findById(id))?.verifications.employment).not.toBeNull();
  });

  it('should give up after three lost races and let the job retry', async () => {
    const t = setup();
    const id = await saved(t, aSubmittedApplication());
    t.applications.conflicts = 3;

    await expect(t.run.execute(new RunVerificationCommand(id, 'employment'))).rejects.toThrow(
      ConcurrentModificationError,
    );
  });

  it('should fail loudly when there is no policy to score with', async () => {
    const t = setup();
    const empty = new ScoreApplicationHandler(
      new InlineUnitOfWork(),
      t.applications,
      new InMemoryRiskPolicyRepository(),
      t.clock,
    );
    const id = await saved(t, aSubmittedApplication());
    await verifyAll(t, id);

    await expect(empty.execute(new ScoreApplicationCommand(id))).rejects.toThrow(
      /cannot be scored/,
    );
  });
});

describe('expiry', () => {
  it(`should expire an application left ${String(EXPIRY_DAYS)} days without moving, once`, async () => {
    const t = setup();
    const id = await saved(t, aDraftApplication());

    t.clock.set(new Date(NOW.getTime() + (EXPIRY_DAYS - 1) * DAY_MS));
    expect(await t.expire.execute(new ExpireApplicationCommand(id))).toBe(false);
    t.clock.set(new Date(NOW.getTime() + EXPIRY_DAYS * DAY_MS));
    expect(await t.expire.execute(new ExpireApplicationCommand(id))).toBe(true);
    expect(await t.expire.execute(new ExpireApplicationCommand(id))).toBe(false);

    expect((await t.applications.findById(id))?.status).toBe('expired');
    expect(t.events.ofType(OriginationEvents.ApplicationExpired)).toHaveLength(1);
  });

  it('should list stale applications oldest first, leaving final ones out', async () => {
    const t = setup();
    const draft = await saved(t, aDraftApplication());
    const cancelled = aDraftApplication();
    cancelled.cancel(NOW);
    await saved(t, cancelled);

    expect(await t.applications.findStaleIds(new Date(NOW.getTime() + 1), 10)).toEqual([draft]);
  });
});

describe('risk policy', () => {
  it('should let an admin publish the next version and record what changed', async () => {
    const t = setup();

    const next = await t.revise.execute(
      new ReviseRiskPolicyCommand(ADMIN, {
        maxFinanceableCents: 15_000_00,
        allowedResidenceCountries: ['es', 'pt'],
        weightsBasisPoints: {
          employability: 3_000,
          employmentHistory: 3_000,
          affordability: 2_000,
          bureau: 2_000,
        },
      }),
    );

    expect(next).toMatchObject({
      version: 2,
      maxFinanceableCents: 15_000_00,
      allowedResidenceCountries: ['ES', 'PT'],
      createdBy: 'admin-1',
    });
    expect((await t.currentPolicy.execute(new GetCurrentRiskPolicyQuery(OPS))).version).toBe(2);
    expect(Object.keys(t.audited[0] ?? {})).toEqual([
      'version',
      'maxFinanceableCents',
      'allowedResidenceCountries',
      'weightsBasisPoints',
    ]);
  });

  it('should refuse an invalid policy, ops revising it and students reading it', async () => {
    const t = setup();

    await expect(
      t.revise.execute(new ReviseRiskPolicyCommand(ADMIN, { reviewThreshold: 80 })),
    ).rejects.toThrow(InvalidRiskPolicyError);
    await expect(
      t.revise.execute(new ReviseRiskPolicyCommand(OPS, { approveThreshold: 80 })),
    ).rejects.toThrow(ApplicationAccessDeniedError);
    await expect(
      t.currentPolicy.execute(
        new GetCurrentRiskPolicyQuery({
          kind: 'user',
          userId: 's',
          roles: ['student'],
          centerId: null,
        }),
      ),
    ).rejects.toThrow(ApplicationAccessDeniedError);
  });
});
