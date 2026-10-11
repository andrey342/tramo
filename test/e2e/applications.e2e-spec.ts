import { type INestApplication } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { RunVerificationCommand } from '../../src/modules/origination/application/commands/run-verification.command';
import { ScoreApplicationCommand } from '../../src/modules/origination/application/commands/score-application.command';
import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

// 56781234F: the simulated employment record shows 19 months worked and 1,725 EUR a month now.
const PROFILE = {
  dateOfBirth: '1998-05-20',
  nationalId: '56781234F',
  residenceCountry: 'ES',
  declaredMonthlyIncomeCents: 180_000,
  employmentStatus: 'employed',
};

type Row = { id: string; score: number | null };
const rows = (body: unknown): Row[] => (body as { data: Row[] }).data;

describe('Applications (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let opsToken: string;
  let centerToken: string;
  let apiKey: string;
  let programId: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
    opsToken = await accessTokenFor(app, await createStaffUser(app, 'ops'));
    const centerId = await registerCenter(app, adminToken, { name: 'Applications School' });
    const centerEmail = `applications-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(adminToken))
      .send({ email: centerEmail, password: TEST_PASSWORD });
    centerToken = await accessTokenFor(app, { email: centerEmail, password: TEST_PASSWORD });
    const key = await api()
      .post(`/api/v1/centers/${centerId}/api-keys`)
      .set(...bearer(centerToken))
      .send({ name: 'Admissions', scopes: ['applications:read', 'applications:write'] });
    apiKey = key.body.key as string;
    const program = await api()
      .post(`/api/v1/centers/${centerId}/programs`)
      .set(...bearer(centerToken))
      .set('Idempotency-Key', uuidv7())
      .send({
        name: 'Data Bootcamp',
        modality: 'online',
        priceCents: 750_000,
        durationWeeks: 16,
        startDates: ['2027-01-11'],
        employabilityRateBasisPoints: 8_500,
        avgStartingSalaryCents: 2_800_000,
        financing: { installments: { allowedTerms: [12, 24], annualRateBasisPoints: 750 } },
      });
    programId = program.body.id as string;
    await api()
      .patch(`/api/v1/programs/${programId}`)
      .set(...bearer(centerToken))
      .send({ status: 'published' });
  });

  afterAll(async () => {
    await app.close();
  });

  async function newStudent(): Promise<{ email: string; token: string }> {
    const email = `student-${uuidv7().slice(-12)}@example.com`;
    await api().post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD });
    return { email, token: await accessTokenFor(app, { email, password: TEST_PASSWORD }) };
  }

  const start = (auth: [string, string], body: object) =>
    api()
      .post('/api/v1/applications')
      .set(...auth)
      .set('Idempotency-Key', uuidv7())
      .send(body);

  // What the worker does after ApplicationSubmitted: the api process runs the same commands.
  async function runSaga(id: string): Promise<void> {
    const commands = app.get(CommandBus);
    for (const type of ['kyc', 'employment', 'bureau'] as const) {
      await commands.execute(new RunVerificationCommand(id, type));
    }
    await commands.execute(new ScoreApplicationCommand(id));
  }

  it('should take a student from draft to an accepted offer, explaining the decision', async () => {
    const student = await newStudent();

    const draft = await start(bearer(student.token), {
      programId,
      product: { kind: 'installments', termMonths: 24 },
    });
    const completed = await api()
      .patch(`/api/v1/applications/${draft.body.id as string}`)
      .set(...bearer(student.token))
      .send({ profile: PROFILE });
    const submitted = await api()
      .post(`/api/v1/applications/${draft.body.id as string}/submit`)
      .set('Idempotency-Key', uuidv7())
      .set(...bearer(student.token));
    await runSaga(draft.body.id as string);
    const decision = await api()
      .get(`/api/v1/applications/${draft.body.id as string}/decision`)
      .set(...bearer(student.token));
    const accepted = await api()
      .post(`/api/v1/applications/${draft.body.id as string}/accept-offer`)
      .set(...bearer(student.token))
      .set('Idempotency-Key', uuidv7());

    expect(draft.status).toBe(201);
    expect(draft.body).toMatchObject({ status: 'draft', amountCents: 750_000 });
    expect(completed.body.profile).toMatchObject({ nationalIdMasked: '*****234F' });
    expect(submitted.status).toBe(200);
    expect(submitted.body.status).toBe('submitted');
    expect(decision.status).toBe(200);
    expect(decision.body).toMatchObject({ outcome: 'approved', policyVersion: expect.any(Number) });
    expect(decision.body.factors).toHaveLength(4);
    expect(accepted.status).toBe(200);
    expect(accepted.body.status).toBe('offer_accepted');
  });

  it("should let a center start one for its student, and keep the student's data from it", async () => {
    const student = await newStudent();

    const withData = await start(['X-API-Key', apiKey], {
      programId,
      product: { kind: 'installments', termMonths: 12 },
      profile: PROFILE,
      studentEmail: student.email,
    });
    const created = await start(['X-API-Key', apiKey], {
      programId,
      product: { kind: 'installments', termMonths: 12 },
      studentEmail: student.email,
    });
    await api()
      .patch(`/api/v1/applications/${created.body.id as string}`)
      .set(...bearer(student.token))
      .send({ profile: PROFILE });
    await api()
      .post(`/api/v1/applications/${created.body.id as string}/submit`)
      .set('Idempotency-Key', uuidv7())
      .set(...bearer(student.token));
    await runSaga(created.body.id as string);
    const seenByCenter = await api()
      .get(`/api/v1/applications/${created.body.id as string}`)
      .set(...bearer(centerToken));
    const seenByStudent = await api()
      .get(`/api/v1/applications/${created.body.id as string}`)
      .set(...bearer(student.token));
    const decisionByCenter = await api()
      .get(`/api/v1/applications/${created.body.id as string}/decision`)
      .set(...bearer(centerToken));
    const submitByKey = await api()
      .post(`/api/v1/applications/${created.body.id as string}/submit`)
      .set('Idempotency-Key', uuidv7())
      .set('X-API-Key', apiKey);

    expect(withData.status).toBe(403);
    expect(withData.body.code).toBe('profile_from_student_only');
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ origin: 'center', profile: null });
    expect(seenByCenter.body).toMatchObject({ status: 'approved', profile: null, score: null });
    expect(seenByStudent.body.profile).not.toBeNull();
    expect(seenByStudent.body.score).toEqual(expect.any(Number));
    expect(decisionByCenter.status).toBe(403);
    expect(submitByKey.status).toBe(403);
  });

  it('should send a borderline applicant to review for ops to settle', async () => {
    const student = await newStudent();
    const draft = await start(bearer(student.token), {
      programId,
      product: { kind: 'installments', termMonths: 12 },
      // With no income affordability adds nothing; the simulated history and bureau score of
      // 12345678Z (22 months, 711) then give 34 + 22.92 + 10.67 = 67.59: review.
      profile: {
        ...PROFILE,
        nationalId: '12345678Z',
        declaredMonthlyIncomeCents: 0,
        employmentStatus: 'unemployed',
      },
    });
    const id = draft.body.id as string;
    await api()
      .post(`/api/v1/applications/${id}/submit`)
      .set('Idempotency-Key', uuidv7())
      .set(...bearer(student.token));
    await runSaga(id);

    const queue = await api()
      .get('/api/v1/ops/applications/review-queue')
      .set(...bearer(opsToken));
    const forbidden = await api()
      .post(`/api/v1/ops/applications/${id}/decide`)
      .set(...bearer(student.token))
      .send({ outcome: 'approved', reason: 'Me' });
    const decided = await api()
      .post(`/api/v1/ops/applications/${id}/decide`)
      .set(...bearer(opsToken))
      .send({ outcome: 'rejected', reason: 'No income to pay from' });

    expect(rows(queue.body).map((row) => row.id)).toContain(id);
    expect(rows(queue.body).find((row) => row.id === id)?.score).toBe(67.59);
    expect(forbidden.status).toBe(403);
    expect(decided.status).toBe(200);
    expect(decided.body.status).toBe('rejected');
  });

  it('should list by caller and refuse what each may not do', async () => {
    const ana = await newStudent();
    const luis = await newStudent();
    const anas = await start(bearer(ana.token), {
      programId,
      product: { kind: 'installments', termMonths: 24 },
    });
    await start(bearer(luis.token), {
      programId,
      product: { kind: 'installments', termMonths: 24 },
    });

    const anaList = await api()
      .get('/api/v1/applications')
      .set(...bearer(ana.token));
    const luisReadsAna = await api()
      .get(`/api/v1/applications/${anas.body.id as string}`)
      .set(...bearer(luis.token));
    const incomplete = await api()
      .post(`/api/v1/applications/${anas.body.id as string}/submit`)
      .set('Idempotency-Key', uuidv7())
      .set(...bearer(ana.token));
    const second = await start(bearer(ana.token), {
      programId,
      product: { kind: 'installments', termMonths: 12 },
    });
    const nullField = await api()
      .patch(`/api/v1/applications/${anas.body.id as string}`)
      .set(...bearer(ana.token))
      .send({ profile: { nationalId: null } });
    const badTerm = await start(bearer(ana.token), {
      programId,
      product: { kind: 'installments', termMonths: 36 },
    });
    const noProduct = await start(bearer(ana.token), { programId });
    const opsCannotApply = await start(bearer(opsToken), {
      programId,
      product: { kind: 'installments', termMonths: 24 },
    });

    expect(rows(anaList.body).map((row) => row.id)).toEqual([anas.body.id]);
    expect(luisReadsAna.status).toBe(404);
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.code).toBe('application_incomplete');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('application_already_open');
    expect(nullField.status).toBe(400);
    expect(badTerm.status).toBe(422);
    expect(badTerm.body.code).toBe('product_not_offered');
    expect(noProduct.status).toBe(400);
    expect(opsCannotApply.status).toBe(403);
  });

  it('should show ops the risk policy and let only admins publish a new version', async () => {
    const current = await api()
      .get('/api/v1/risk-policies/current')
      .set(...bearer(opsToken));
    const byOps = await api()
      .post('/api/v1/risk-policies')
      .set(...bearer(opsToken))
      .send({ approveThreshold: 75 });
    const invalid = await api()
      .post('/api/v1/risk-policies')
      .set(...bearer(adminToken))
      .send({ approveThreshold: 40 });

    expect(current.status).toBe(200);
    expect(current.body.maxFinanceableCents).toBe(1_200_000);
    expect(byOps.status).toBe(403);
    expect(invalid.status).toBe(422);
    expect(invalid.body.code).toBe('invalid_risk_policy');
  });
});
