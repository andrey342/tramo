import { type ApplicationQueries } from '../../src/modules/origination/application/ports/origination-ports';
import {
  type FinancingApplication,
  type FinancingApplicationRepository,
  RiskPolicy,
  type RiskPolicyRepository,
  ScoringEngine,
} from '../../src/modules/origination/domain';
import { ConcurrentModificationError } from '../../src/shared/domain';
import {
  aDraftApplication,
  anApplicationInScoring,
  aProgramSnapshot,
  LATER,
  NOW,
} from '../factories/origination';

export interface OriginationRepositoriesHarness {
  readonly applications: FinancingApplicationRepository;
  readonly policies: RiskPolicyRepository;
  readonly queries: ApplicationQueries;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const state = (application: FinancingApplication) => ({
  applicantId: application.applicantId,
  origin: application.origin,
  program: application.program,
  product: application.product,
  profile: application.profile,
  verifications: application.verifications,
  decision: application.decision,
  manualDecision: application.manualDecision,
  status: application.status,
  statusChangedAt: application.statusChangedAt,
  createdAt: application.createdAt,
});

function decided(outcome: 'approved' | 'needs_review', centerId: string, at: Date) {
  const application = anApplicationInScoring({ program: aProgramSnapshot({ centerId }) });
  const { kyc, employment, bureau } = application.verifications;
  if (!kyc || !employment || !bureau) throw new Error('Factory left verifications out.');
  const decision = ScoringEngine.decide(
    {
      profile: application.submittedProfile,
      program: application.program,
      product: application.product,
      kyc,
      employment,
      bureau,
    },
    RiskPolicy.initial(NOW),
    NOW,
  );
  application.decide({ ...decision, outcome }, at);
  return application;
}

// The TypeORM repositories and read model and their in-memory fakes behave the same. Every test
// works on rows of its own (fresh ids and centers), so data left by other suites does not matter.
export function originationRepositoriesContract(
  name: string,
  create: () => Promise<OriginationRepositoriesHarness> | OriginationRepositoriesHarness,
): void {
  describe(`${name} (origination repositories contract)`, () => {
    let t: OriginationRepositoriesHarness;

    beforeEach(async () => {
      t = await create();
    });

    it('should load an application as it was saved, decision and all', async () => {
      const draft = aDraftApplication();
      const decidedOne = decided('needs_review', draft.centerId, LATER);
      decidedOne.decideManually(
        { outcome: 'approved', reason: 'Stable job', decidedBy: 'ops-1' },
        LATER,
      );
      await t.run(async () => {
        await t.applications.save(draft);
        await t.applications.save(decidedOne);
      });

      const [loadedDraft, loadedDecided] = await Promise.all([
        t.applications.findById(draft.id),
        t.applications.findById(decidedOne.id),
      ]);

      expect(loadedDraft && state(loadedDraft)).toEqual(state(draft));
      expect(loadedDecided && state(loadedDecided)).toEqual(state(decidedOne));
      expect(await t.applications.findById('0199a000-0000-7000-8000-0000000000ff')).toBeNull();
    });

    it('should list stale applications that are not final, oldest first', async () => {
      const centerId = aProgramSnapshot().centerId;
      const old = aDraftApplication({ program: aProgramSnapshot({ centerId }) });
      const cancelled = aDraftApplication({ program: aProgramSnapshot({ centerId }) });
      cancelled.cancel(NOW);
      await t.run(async () => {
        await t.applications.save(old);
        await t.applications.save(cancelled);
      });

      const stale = await t.applications.findStaleIds(new Date(NOW.getTime() + DAY_MS), 1_000);

      expect(stale).toContain(old.id);
      expect(stale).not.toContain(cancelled.id);
    });

    it('should list by applicant, center and status, newest first, page by page', async () => {
      const centerId = aProgramSnapshot().centerId;
      const program = aProgramSnapshot({ centerId });
      const applicantId = aDraftApplication().applicantId;
      const older = aDraftApplication({ program, applicantId });
      const newer = decided('approved', centerId, LATER);
      const someoneElse = aDraftApplication({ program });
      await t.run(async () => {
        await t.applications.save(older);
        await t.applications.save(newer);
        await t.applications.save(someoneElse);
      });
      const ids = (page: { data: readonly { id: string }[] }) => page.data.map((row) => row.id);

      const first = await t.queries.list({ centerId }, { limit: 2 });
      const second = await t.queries.list(
        { centerId },
        { limit: 2, cursor: first.nextCursor ?? undefined },
      );

      expect([...ids(first), ...ids(second)].sort()).toEqual(
        [older.id, newer.id, someoneElse.id].sort(),
      );
      expect(second.nextCursor).toBeNull();
      expect(ids(await t.queries.list({ applicantId }, { limit: 10 }))).toEqual([older.id]);
      expect(await t.queries.list({ centerId, status: 'approved' }, { limit: 10 })).toEqual({
        data: [
          {
            id: newer.id,
            applicantId: newer.applicantId,
            centerId,
            programId: newer.program.programId,
            programName: 'Full Stack Bootcamp',
            amountCents: 750_000,
            product: 'installments',
            status: 'approved',
            score: newer.decision?.score,
            statusChangedAt: LATER,
            createdAt: newer.createdAt,
          },
        ],
        nextCursor: null,
      });
    });

    it('should queue reviews by how long they have waited', async () => {
      const centerId = aProgramSnapshot().centerId;
      const waitingLonger = decided('needs_review', centerId, new Date('2000-01-01T00:00:00Z'));
      const waiting = decided('needs_review', centerId, new Date('2000-01-02T00:00:00Z'));
      await t.run(async () => {
        await t.applications.save(waiting);
        await t.applications.save(waitingLonger);
      });

      const queue = await t.queries.reviewQueue({ limit: 2 });

      // Older suites' rows may be in the queue too; these two are the oldest possible.
      expect(queue.data.map((row) => row.id)).toEqual([waitingLonger.id, waiting.id]);
    });

    it('should keep every policy version and answer with the highest', async () => {
      // Other suites revise the shared policy table too: retry once on top of theirs.
      const addNext = async () => {
        const current = await t.policies.findCurrent();
        if (!current) throw new Error('No policy seeded.');
        const next = current.revise({}, 'admin-1', NOW);
        await t.run(() => t.policies.add(next));
        return { current, next };
      };
      const { current, next } = await addNext().catch((error: unknown) => {
        if (error instanceof ConcurrentModificationError) return addNext();
        throw error;
      });

      expect((await t.policies.findCurrent())?.version).toBe(next.version);
      expect(await t.policies.findByVersion(current.version)).toEqual(current);
      await expect(t.run(() => t.policies.add(next))).rejects.toThrow(ConcurrentModificationError);
    });
  });
}
