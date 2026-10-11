import { type AuditChanges, type Principal } from '@shared/application';
import {
  EntityNotFoundError,
  FixedClock,
  InvalidValueError,
  Money,
  Percentage,
} from '@shared/domain';

import { aProgramSnapshot, LATER, NOW, VALID_DNI } from '../../../../test/factories/origination';
import {
  FakeProgramDirectory,
  FakeStudentDirectory,
  InMemoryApplicationQueries,
  InMemoryFinancingApplicationRepository,
} from '../../../../test/fakes/origination';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  ApplicationAccessDeniedError,
  ApplicationIncompleteError,
  OriginationEvents,
  ProgramNotAvailableError,
  RiskPolicy,
  ScoringEngine,
  StudentNotFoundError,
} from '../domain';

import { AcceptOfferCommand, AcceptOfferHandler } from './commands/accept-offer.command';
import {
  CancelApplicationCommand,
  CancelApplicationHandler,
} from './commands/cancel-application.command';
import {
  DecideApplicationCommand,
  DecideApplicationHandler,
} from './commands/decide-application.command';
import {
  StartApplicationCommand,
  StartApplicationHandler,
  type StartApplicationInput,
} from './commands/start-application.command';
import {
  SubmitApplicationCommand,
  SubmitApplicationHandler,
} from './commands/submit-application.command';
import {
  UpdateApplicationDraftCommand,
  UpdateApplicationDraftHandler,
} from './commands/update-application-draft.command';
import {
  GetApplicationDecisionHandler,
  GetApplicationDecisionQuery,
} from './queries/get-application-decision.query';
import { GetApplicationHandler, GetApplicationQuery } from './queries/get-application.query';
import { GetReviewQueueHandler, GetReviewQueueQuery } from './queries/get-review-queue.query';
import { ListApplicationsHandler, ListApplicationsQuery } from './queries/list-applications.query';

const PROGRAM = aProgramSnapshot();
const OTHER_CENTER_PROGRAM = aProgramSnapshot();
const STUDENT_EMAIL = 'ana.garcia@example.com';

const student = (userId: string): Principal => ({
  kind: 'user',
  userId,
  roles: ['student'],
  centerId: null,
});
const ANA = student('student-ana');
const LUIS = student('student-luis');
const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };
const CENTER_ADMIN: Principal = {
  kind: 'user',
  userId: 'center-admin-1',
  roles: ['center_admin'],
  centerId: PROGRAM.centerId,
};
const centerKey = (scopes: ('applications:read' | 'applications:write')[]): Principal => ({
  kind: 'api_key',
  apiKeyId: 'key-1',
  centerId: PROGRAM.centerId,
  scopes,
});

const COMPLETE: StartApplicationInput = {
  programId: PROGRAM.programId,
  product: { kind: 'installments', termMonths: 24 },
  profile: {
    dateOfBirth: '1998-05-20',
    nationalId: VALID_DNI,
    residenceCountry: 'es',
    declaredMonthlyIncomeCents: 1_800_00,
    employmentStatus: 'employed',
  },
};

function setup() {
  const clock = new FixedClock(NOW);
  const uow = new InlineUnitOfWork();
  const events = new RecordingEventBus();
  const applications = new InMemoryFinancingApplicationRepository(events);
  const programs = new FakeProgramDirectory([PROGRAM, OTHER_CENTER_PROGRAM]);
  const students = new FakeStudentDirectory({ [STUDENT_EMAIL]: 'student-ana' });
  const audited: AuditChanges[] = [];
  const audit = { describeChanges: (changes: AuditChanges) => audited.push(changes) };
  const queries = new InMemoryApplicationQueries(applications);
  return {
    clock,
    events,
    applications,
    programs,
    audited,
    start: new StartApplicationHandler(uow, applications, programs, students, clock),
    update: new UpdateApplicationDraftHandler(uow, applications, programs, clock),
    submit: new SubmitApplicationHandler(uow, applications, programs, clock),
    cancel: new CancelApplicationHandler(uow, applications, clock),
    accept: new AcceptOfferHandler(uow, applications, clock),
    decide: new DecideApplicationHandler(uow, applications, audit, clock),
    get: new GetApplicationHandler(applications),
    decision: new GetApplicationDecisionHandler(applications),
    list: new ListApplicationsHandler(queries),
    reviewQueue: new GetReviewQueueHandler(queries),
  };
}

type Kit = ReturnType<typeof setup>;

async function submitted(t: Kit, actor: Principal = ANA): Promise<string> {
  const draft = await t.start.execute(new StartApplicationCommand(actor, COMPLETE));
  await t.submit.execute(new SubmitApplicationCommand(actor, draft.id));
  return draft.id;
}

describe('application use cases', () => {
  describe('StartApplication', () => {
    it('should start a draft for a student, with their personal data', async () => {
      const t = setup();

      const draft = await t.start.execute(new StartApplicationCommand(ANA, COMPLETE));

      expect(draft).toMatchObject({
        status: 'draft',
        origin: 'student',
        applicantId: 'student-ana',
        amountCents: 750_000,
        product: { kind: 'installments', termMonths: 24 },
        profile: { nationalIdMasked: '*****678Z', residenceCountry: 'ES' },
      });
      expect(t.events.published).toEqual([]);
    });

    it("should start one for a center's student, by email, without showing the center their data", async () => {
      const t = setup();

      const draft = await t.start.execute(
        new StartApplicationCommand(centerKey(['applications:write']), {
          ...COMPLETE,
          studentEmail: STUDENT_EMAIL,
        }),
      );

      expect(draft).toMatchObject({ origin: 'center', applicantId: 'student-ana', profile: null });
    });

    it.each([
      [
        'an unknown student',
        centerKey(['applications:write']),
        'nobody@example.com',
        StudentNotFoundError,
      ],
      [
        'a key that may only read',
        centerKey(['applications:read']),
        STUDENT_EMAIL,
        ApplicationAccessDeniedError,
      ],
      ['staff', OPS, undefined, ApplicationAccessDeniedError],
      ['a center admin user', CENTER_ADMIN, STUDENT_EMAIL, ApplicationAccessDeniedError],
    ])('should refuse %s', async (_case, actor, studentEmail, error) => {
      const t = setup();

      await expect(
        t.start.execute(new StartApplicationCommand(actor, { ...COMPLETE, studentEmail })),
      ).rejects.toThrow(error);
    });

    it("should refuse a center applying for another center's program, and a closed program", async () => {
      const t = setup();

      await expect(
        t.start.execute(
          new StartApplicationCommand(centerKey(['applications:write']), {
            ...COMPLETE,
            programId: OTHER_CENTER_PROGRAM.programId,
            studentEmail: STUDENT_EMAIL,
          }),
        ),
      ).rejects.toThrow(ApplicationAccessDeniedError);
      await expect(
        t.start.execute(new StartApplicationCommand(ANA, { ...COMPLETE, programId: 'closed' })),
      ).rejects.toThrow(ProgramNotAvailableError);
      await expect(
        t.start.execute(
          new StartApplicationCommand(ANA, { ...COMPLETE, profile: { nationalId: '12345678A' } }),
        ),
      ).rejects.toThrow(InvalidValueError);
    });
  });

  describe('drafts and submission', () => {
    it('should let the student complete the draft and submit it at the current price', async () => {
      const t = setup();
      const draft = await t.start.execute(
        new StartApplicationCommand(ANA, { ...COMPLETE, profile: {} }),
      );

      await t.update.execute(
        new UpdateApplicationDraftCommand(ANA, draft.id, { profile: COMPLETE.profile }),
      );
      t.programs.open({ ...PROGRAM, price: Money.fromCents(6_900_00) });
      const result = await t.submit.execute(new SubmitApplicationCommand(ANA, draft.id));

      expect(result).toMatchObject({ status: 'submitted', amountCents: 690_000 });
      expect(t.events.ofType(OriginationEvents.ApplicationSubmitted)).toHaveLength(1);
    });

    it('should name what is missing on submit', async () => {
      const t = setup();
      const draft = await t.start.execute(
        new StartApplicationCommand(ANA, { ...COMPLETE, profile: { residenceCountry: 'ES' } }),
      );

      await expect(t.submit.execute(new SubmitApplicationCommand(ANA, draft.id))).rejects.toThrow(
        ApplicationIncompleteError,
      );
    });

    it('should refuse to submit for a program that closed meanwhile', async () => {
      const t = setup();
      const draft = await t.start.execute(new StartApplicationCommand(ANA, COMPLETE));
      t.programs.close(PROGRAM.programId);

      await expect(t.submit.execute(new SubmitApplicationCommand(ANA, draft.id))).rejects.toThrow(
        ProgramNotAvailableError,
      );
    });

    it('should let the center complete what it started, but leave submitting to the student', async () => {
      const t = setup();
      const key = centerKey(['applications:write']);
      const draft = await t.start.execute(
        new StartApplicationCommand(key, { ...COMPLETE, profile: {}, studentEmail: STUDENT_EMAIL }),
      );

      const updated = await t.update.execute(
        new UpdateApplicationDraftCommand(key, draft.id, { profile: COMPLETE.profile }),
      );

      expect(updated.profile).toBeNull();
      await expect(t.submit.execute(new SubmitApplicationCommand(key, draft.id))).rejects.toThrow(
        ApplicationAccessDeniedError,
      );
      await expect(
        t.update.execute(
          new UpdateApplicationDraftCommand(key, draft.id, {
            programId: OTHER_CENTER_PROGRAM.programId,
          }),
        ),
      ).rejects.toThrow(ProgramNotAvailableError);
      expect((await t.submit.execute(new SubmitApplicationCommand(ANA, draft.id))).status).toBe(
        'submitted',
      );
    });

    it("should hide another student's application and keep the center out of the student's own drafts", async () => {
      const t = setup();
      const draft = await t.start.execute(new StartApplicationCommand(ANA, COMPLETE));

      await expect(
        t.update.execute(new UpdateApplicationDraftCommand(LUIS, draft.id, { profile: {} })),
      ).rejects.toThrow(EntityNotFoundError);
      await expect(
        t.update.execute(
          new UpdateApplicationDraftCommand(centerKey(['applications:write']), draft.id, {
            profile: {},
          }),
        ),
      ).rejects.toThrow(ApplicationAccessDeniedError);
      await expect(t.cancel.execute(new CancelApplicationCommand(LUIS, draft.id))).rejects.toThrow(
        EntityNotFoundError,
      );
    });
  });

  describe('cancel and accept', () => {
    it('should let the student cancel, and nobody else', async () => {
      const t = setup();
      const id = await submitted(t);

      await expect(
        t.cancel.execute(new CancelApplicationCommand(CENTER_ADMIN, id)),
      ).rejects.toThrow(ApplicationAccessDeniedError);
      const cancelled = await t.cancel.execute(new CancelApplicationCommand(ANA, id));

      expect(cancelled.status).toBe('cancelled');
    });

    it('should let the student accept an approved offer', async () => {
      const t = setup();
      const id = await approvedApplication(t);

      const accepted = await t.accept.execute(new AcceptOfferCommand(ANA, id));

      expect(accepted.status).toBe('offer_accepted');
      expect(t.events.ofType(OriginationEvents.OfferAccepted)).toHaveLength(1);
    });
  });

  describe('reading', () => {
    it('should show personal data to the student and staff only', async () => {
      const t = setup();
      const id = await submitted(t);

      expect((await t.get.execute(new GetApplicationQuery(ANA, id))).profile).not.toBeNull();
      expect((await t.get.execute(new GetApplicationQuery(OPS, id))).profile).not.toBeNull();
      expect((await t.get.execute(new GetApplicationQuery(CENTER_ADMIN, id))).profile).toBeNull();
      expect(
        (await t.get.execute(new GetApplicationQuery(centerKey(['applications:read']), id))).status,
      ).toBe('submitted');
      await expect(t.get.execute(new GetApplicationQuery(LUIS, id))).rejects.toThrow(
        EntityNotFoundError,
      );
    });

    it('should explain a decision to the student and staff, not the center', async () => {
      const t = setup();
      const pending = await submitted(t);
      const id = await approvedApplication(t);

      const explained = await t.decision.execute(new GetApplicationDecisionQuery(ANA, id));

      expect(explained).toMatchObject({ outcome: 'approved', policyVersion: 1 });
      expect(explained.factors).toHaveLength(4);
      await expect(
        t.decision.execute(new GetApplicationDecisionQuery(CENTER_ADMIN, id)),
      ).rejects.toThrow(ApplicationAccessDeniedError);
      await expect(
        t.decision.execute(new GetApplicationDecisionQuery(ANA, pending)),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should list what each caller may see', async () => {
      const t = setup();
      const anas = await submitted(t);
      const luis = await submitted(t, LUIS);
      const page = { limit: 10 };

      const ids = async (actor: Principal, status?: 'submitted' | 'draft') =>
        (await t.list.execute(new ListApplicationsQuery(actor, status, page))).data.map(
          (row) => row.id,
        );

      expect(await ids(ANA)).toEqual([anas]);
      expect((await ids(CENTER_ADMIN)).sort()).toEqual([anas, luis].sort());
      expect((await ids(centerKey(['applications:read']))).sort()).toEqual([anas, luis].sort());
      expect((await ids(OPS, 'submitted')).sort()).toEqual([anas, luis].sort());
      expect(await ids(OPS, 'draft')).toEqual([]);
      await expect(
        t.list.execute(new ListApplicationsQuery({ kind: 'anonymous' }, undefined, page)),
      ).rejects.toThrow(ApplicationAccessDeniedError);
    });
  });

  describe('manual review', () => {
    it('should queue reviews for staff, oldest first, and let ops settle them with a reason', async () => {
      const t = setup();
      const first = await inReview(t, NOW);
      const second = await inReview(t, LATER);

      const queue = await t.reviewQueue.execute(new GetReviewQueueQuery(OPS, { limit: 10 }));
      const decided = await t.decide.execute(
        new DecideApplicationCommand(OPS, first, 'approved', 'Stable job, low risk'),
      );

      expect(queue.data.map((row) => row.id)).toEqual([first, second]);
      expect(decided.status).toBe('approved');
      expect(t.audited).toEqual([
        {
          status: { before: 'needs_review', after: 'approved' },
          reason: { before: null, after: 'Stable job, low risk' },
        },
      ]);
      await expect(
        t.reviewQueue.execute(new GetReviewQueueQuery(ANA, { limit: 10 })),
      ).rejects.toThrow(ApplicationAccessDeniedError);
      await expect(
        t.decide.execute(new DecideApplicationCommand(ANA, second, 'approved', 'Me')),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});

// Submitted, verified and scored by the engine with the outcome forced.
async function scored(t: Kit, outcome: 'approved' | 'needs_review', at: Date): Promise<string> {
  const id = await submitted(t);
  const application = await t.applications.findById(id);
  if (!application) throw new Error(`Application ${id} was not saved.`);
  application.recordVerification(
    {
      type: 'kyc',
      result: {
        verified: true,
        confidence: Percentage.fromPercent(95),
        reasons: [],
        provider: 'fake',
      },
    },
    at,
  );
  application.recordVerification(
    {
      type: 'employment',
      result: {
        monthsWorkedLast24: 24,
        currentlyEmployed: true,
        currentMonthlyIncome: null,
        provider: 'fake',
      },
    },
    at,
  );
  application.recordVerification(
    { type: 'bureau', result: { listedInDefaultRegistry: false, score: 800, provider: 'fake' } },
    at,
  );
  const { kyc, employment, bureau } = application.verifications;
  if (!kyc || !employment || !bureau) throw new Error('Verifications missing.');
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
    at,
  );
  application.decide({ ...decision, outcome }, at);
  await t.applications.save(application);
  return id;
}

const approvedApplication = (t: Kit) => scored(t, 'approved', LATER);
const inReview = (t: Kit, at: Date) => scored(t, 'needs_review', at);
