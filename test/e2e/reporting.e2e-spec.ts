import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

describe('Reporting (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let opsToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
    opsToken = await accessTokenFor(app, await createStaffUser(app, 'ops'));
  });

  afterAll(async () => {
    await app.close();
  });

  async function centerWithAdmin(): Promise<{ centerId: string; token: string }> {
    const centerId = await registerCenter(app, adminToken);
    const email = `center-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(adminToken))
      .send({ email, password: TEST_PASSWORD });
    return { centerId, token: await accessTokenFor(app, { email, password: TEST_PASSWORD }) };
  }

  it('should show a center its dashboard, and nobody else', async () => {
    const { centerId, token } = await centerWithAdmin();
    const other = await centerWithAdmin();

    const own = await api()
      .get(`/api/v1/centers/${centerId}/dashboard`)
      .set(...bearer(token));
    const byOps = await api()
      .get(`/api/v1/centers/${centerId}/dashboard`)
      .set(...bearer(opsToken));
    const byOther = await api()
      .get(`/api/v1/centers/${centerId}/dashboard`)
      .set(...bearer(other.token));

    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({
      centerId,
      applications: { submitted: 0, approved: 0 },
      contracts: { active: 0, inArrears: 0 },
      disbursedCents: 0,
      delinquencyRateBasisPoints: null,
    });
    expect(own.body.byProduct).toHaveLength(2);
    expect(byOps.status).toBe(200);
    expect(byOther.status).toBe(403);
    expect(byOther.body.code).toBe('reporting_access_denied');
  });

  it('should keep program performance to the programs of the center', async () => {
    const { centerId, token } = await centerWithAdmin();
    const program = await api()
      .post(`/api/v1/centers/${centerId}/programs`)
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7())
      .send({
        name: 'Data Bootcamp',
        modality: 'online',
        priceCents: 6_000_00,
        durationWeeks: 12,
        startDates: ['2027-01-11'],
        employabilityRateBasisPoints: 8_000,
        avgStartingSalaryCents: 26_000_00,
        financing: { installments: { allowedTerms: [12], annualRateBasisPoints: 900 } },
      });
    const programId = (program.body as { id: string }).id;

    const performance = await api()
      .get(`/api/v1/centers/${centerId}/programs/${programId}/performance`)
      .set(...bearer(token));
    const elsewhere = await api()
      .get(`/api/v1/centers/${uuidv7()}/programs/${programId}/performance`)
      .set(...bearer(opsToken));

    expect(program.status).toBe(201);
    expect(performance.status).toBe(200);
    expect(performance.body).toMatchObject({
      centerId,
      programId,
      applications: 0,
      approvalRateBasisPoints: null,
      averageTicketCents: null,
      averageScore: null,
    });
    expect(elsewhere.status).toBe(404);
  });

  it('should give operations their overview and a rebuild on request, staff only', async () => {
    const { token } = await centerWithAdmin();

    const overview = await api()
      .get('/api/v1/ops/overview')
      .set(...bearer(opsToken));
    const byCenter = await api()
      .get('/api/v1/ops/overview')
      .set(...bearer(token));
    const rebuild = await api()
      .post('/api/v1/ops/reporting/rebuild')
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());

    expect(overview.status).toBe(200);
    expect(overview.body).toEqual({
      reviewQueue: expect.any(Number),
      failedChargesToday: expect.any(Number),
      pendingDisbursements: expect.any(Number),
      failedDisbursements: expect.any(Number),
      contractsInArrears: expect.any(Number),
      deadLetters: expect.any(Number),
      generatedAt: expect.any(String),
    });
    expect(byCenter.status).toBe(403);
    expect(rebuild.status).toBe(202);
    expect(rebuild.body).toEqual({ queued: expect.any(Boolean) });
  });
});
