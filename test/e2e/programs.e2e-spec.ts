import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

const PROGRAM = {
  name: 'Full Stack Bootcamp',
  modality: 'hybrid',
  priceCents: 750_000,
  durationWeeks: 16,
  startDates: ['2027-01-11', '2027-04-05'],
  employabilityRateBasisPoints: 8_500,
  avgStartingSalaryCents: 2_800_000,
  financing: { installments: { allowedTerms: [12, 24], annualRateBasisPoints: 750 } },
};
type ProgramItem = { id: string; priceCents: number };
const items = (body: unknown): ProgramItem[] => (body as { data: ProgramItem[] }).data;

const ISA = {
  incomeShareBasisPoints: 1_000,
  minMonthlyIncomeCents: 150_000,
  maxPayments: 36,
  capMultiplier: 1.5,
  graceMonths: 3,
};

describe('Programs (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let centerId: string;
  let centerToken: string;
  let apiKey: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
    centerId = await activeCenter();
    const email = `programs-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(adminToken))
      .send({ email, password: TEST_PASSWORD });
    centerToken = await accessTokenFor(app, { email, password: TEST_PASSWORD });
    const key = await api()
      .post(`/api/v1/centers/${centerId}/api-keys`)
      .set(...bearer(centerToken))
      .send({ name: 'Admissions system', scopes: ['programs:write'] });
    apiKey = key.body.key as string;
  });

  afterAll(async () => {
    await app.close();
  });

  const activeCenter = (): Promise<string> =>
    registerCenter(app, adminToken, { name: 'Programs School' });

  const createProgram = (
    body: object = PROGRAM,
    auth: [string, string] = ['Authorization', `Bearer ${centerToken}`],
  ) =>
    api()
      .post(`/api/v1/centers/${centerId}/programs`)
      .set(...auth)
      .set('Idempotency-Key', uuidv7())
      .send(body);

  it('should create a draft that the public cannot see but its center can', async () => {
    const created = await createProgram();
    const id = created.body.id as string;

    const anonymous = await api().get(`/api/v1/programs/${id}`);
    const owner = await api()
      .get(`/api/v1/programs/${id}`)
      .set(...bearer(centerToken));
    const forged = await api().get(`/api/v1/programs/${id}`).set('Authorization', 'Bearer forged');

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ status: 'draft', products: ['installments'] });
    expect(anonymous.status).toBe(404);
    expect(owner.status).toBe(200);
    expect(owner.body.status).toBe('draft');
    expect(forged.status).toBe(401);
  });

  it('should publish a program into the public catalog', async () => {
    const created = await createProgram({
      ...PROGRAM,
      financing: { ...PROGRAM.financing, isa: ISA },
    });
    const id = created.body.id as string;

    const published = await api()
      .patch(`/api/v1/programs/${id}`)
      .set(...bearer(centerToken))
      .send({ status: 'published' });
    const listed = await api().get('/api/v1/programs').query({ centerId, product: 'isa' });
    const single = await api().get(`/api/v1/programs/${id}`);

    expect(published.status).toBe(200);
    expect(items(listed.body).map((program) => program.id)).toContain(id);
    expect(single.body).toMatchObject({
      status: 'published',
      centerName: 'Programs School',
      financing: { isa: { capMultiplier: 1.5 } },
    });
  });

  it('should let an API key with programs:write create programs for its center', async () => {
    const created = await createProgram(PROGRAM, ['X-Api-Key', apiKey]);

    expect(created.status).toBe(201);
  });

  it('should page through the catalog with a cursor and filter by price', async () => {
    for (let index = 0; index < 3; index += 1) {
      const created = await createProgram({ ...PROGRAM, priceCents: 400_000 + index });
      await api()
        .patch(`/api/v1/programs/${created.body.id as string}`)
        .set(...bearer(centerToken))
        .send({ status: 'published' });
    }
    const query = { centerId, minPriceCents: 400_000, maxPriceCents: 400_002, limit: 2 };

    const first = await api().get('/api/v1/programs').query(query);
    const second = await api()
      .get('/api/v1/programs')
      .query({ ...query, cursor: first.body.nextCursor as string });

    expect(items(first.body).map((program) => program.priceCents)).toEqual([400_002, 400_001]);
    expect(items(second.body).map((program) => program.priceCents)).toEqual([400_000]);
    expect(second.body.nextCursor).toBeNull();
  });

  it('should explain why a program cannot be offered', async () => {
    const lowEmployability = await createProgram({
      ...PROGRAM,
      employabilityRateBasisPoints: 5_000,
      financing: { isa: ISA },
    });
    const longTerm = await createProgram({
      ...PROGRAM,
      financing: { installments: { allowedTerms: [60], annualRateBasisPoints: 750 } },
    });
    const bareDraft = await createProgram({ ...PROGRAM, financing: {} });
    const publishBare = await api()
      .patch(`/api/v1/programs/${bareDraft.body.id as string}`)
      .set(...bearer(centerToken))
      .send({ status: 'published' });

    expect(lowEmployability.status).toBe(422);
    expect(lowEmployability.body.code).toBe('invalid_financing_option');
    expect(longTerm.status).toBe(422);
    expect(publishBare.status).toBe(422);
    expect(publishBare.body.code).toBe('program_not_publishable');
  });

  it('should answer malformed input with a client error, not a server error', async () => {
    const { financing: _financing, ...withoutFinancing } = PROGRAM;

    const noFinancing = await createProgram(withoutFinancing);
    const impossibleDate = await createProgram({ ...PROGRAM, startDates: ['2027-02-30'] });
    const hugePrice = await api().get('/api/v1/programs').query({ minPriceCents: 99_999_999_999 });

    expect(noFinancing.status).toBe(400);
    expect(noFinancing.body.code).toBe('validation_error');
    expect(impossibleDate.status).toBe(422);
    expect(impossibleDate.body.code).toBe('invalid_value');
    expect(hugePrice.status).toBe(400);
    expect(hugePrice.body.code).toBe('validation_error');
  });

  it('should keep other centers and the public out of changes', async () => {
    const created = await createProgram();
    const otherCenter = await activeCenter();
    const email = `other-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${otherCenter}/users`)
      .set(...bearer(adminToken))
      .send({ email, password: TEST_PASSWORD });
    const otherToken = await accessTokenFor(app, { email, password: TEST_PASSWORD });

    const foreign = await api()
      .patch(`/api/v1/programs/${created.body.id as string}`)
      .set(...bearer(otherToken))
      .send({ status: 'published' });
    const anonymous = await api()
      .patch(`/api/v1/programs/${created.body.id as string}`)
      .send({ status: 'published' });
    const withoutKey = await api()
      .post(`/api/v1/centers/${centerId}/programs`)
      .set(...bearer(centerToken))
      .send(PROGRAM);

    expect(foreign.status).toBe(404);
    expect(anonymous.status).toBe(401);
    expect(withoutKey.status).toBe(400);
  });
});
