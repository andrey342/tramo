import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { aTaxId, OTHER_IBAN, VALID_IBAN } from '../factories/catalog';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

describe('Training centers (e2e)', () => {
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

  const register = (body: Record<string, unknown> = {}, token = adminToken) =>
    api()
      .post('/api/v1/centers')
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7())
      .send({
        name: 'Codeworks Barcelona',
        country: 'ES',
        taxId: aTaxId(),
        payoutIban: VALID_IBAN,
        platformFeeBasisPoints: 500,
        ...body,
      });

  it('should register a center that waits for verification, with its IBAN masked', async () => {
    const created = await register();
    expect(created.status).toBe(201);

    const center = await api()
      .get(`/api/v1/centers/${created.body.id as string}`)
      .set(...bearer(opsToken));

    expect(center.status).toBe(200);
    expect(center.body).toMatchObject({
      status: 'pending_verification',
      vatValidation: null,
      payoutIbanMasked: 'ES91 **** 1332',
      platformFeeBasisPoints: 500,
    });
    expect(JSON.stringify(center.body)).not.toContain(VALID_IBAN);
  });

  it('should activate a center when ops verify its VAT number', async () => {
    const created = await register();

    const verified = await api()
      .post(`/api/v1/centers/${created.body.id as string}/verify-vat`)
      .set(...bearer(opsToken));

    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({ status: 'active', vatValidation: { status: 'valid' } });
  });

  it('should keep a center pending, without an error, while VIES is down', async () => {
    const created = await register({ taxId: '300' });

    const verified = await api()
      .post(`/api/v1/centers/${created.body.id as string}/verify-vat`)
      .set(...bearer(opsToken));

    expect(verified.status).toBe(200);
    expect(verified.body).toMatchObject({
      status: 'pending_verification',
      vatValidation: { status: 'unverified' },
    });
  });

  it('should reject duplicates, invalid IBANs, unknown fields and non-admins', async () => {
    const taxId = aTaxId();
    await register({ taxId });

    const duplicate = await register({ taxId });
    const badIban = await register({ payoutIban: 'ES9121000418450200051333' });
    const unknownField = await register({ status: 'active' });
    const byOps = await register({}, opsToken);

    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe('center_already_registered');
    expect(badIban.status).toBe(422);
    expect(badIban.body.errors).toEqual([
      { field: 'iban', message: 'IBAN check digits do not match.' },
    ]);
    expect(unknownField.status).toBe(400);
    expect(byOps.status).toBe(403);
  });

  it('should require an Idempotency-Key and replay the first answer for a retry', async () => {
    const key = uuidv7();
    const body = {
      name: 'Retry School',
      country: 'ES',
      taxId: aTaxId(),
      payoutIban: VALID_IBAN,
      platformFeeBasisPoints: 300,
    };
    const send = () =>
      api()
        .post('/api/v1/centers')
        .set(...bearer(adminToken))
        .set('Idempotency-Key', key)
        .send(body);

    const withoutKey = await api()
      .post('/api/v1/centers')
      .set(...bearer(adminToken))
      .send(body);
    const first = await send();
    const retry = await send();

    expect(withoutKey.status).toBe(400);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(retry.headers['idempotent-replayed']).toBe('true');
  });

  it('should let an admin change the payout account and suspend, recorded in the audit log', async () => {
    const created = await register();
    const id = created.body.id as string;

    const updated = await api()
      .patch(`/api/v1/centers/${id}`)
      .set(...bearer(adminToken))
      .send({ payoutIban: OTHER_IBAN, status: 'suspended', suspensionReason: 'Audit' });
    const withoutReason = await api()
      .patch(`/api/v1/centers/${id}`)
      .set(...bearer(adminToken))
      .send({ status: 'suspended' });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ status: 'suspended', payoutIbanMasked: 'DE89 **** 3000' });
    expect(withoutReason.status).toBe(400);
  });

  it('should show a center to its own admin only', async () => {
    const created = await register();
    const id = created.body.id as string;
    const email = `center-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${id}/users`)
      .set(...bearer(adminToken))
      .send({ email, password: TEST_PASSWORD });
    const centerToken = await accessTokenFor(app, { email, password: TEST_PASSWORD });
    const other = await register();

    const own = await api()
      .get(`/api/v1/centers/${id}`)
      .set(...bearer(centerToken));
    const foreign = await api()
      .get(`/api/v1/centers/${other.body.id as string}`)
      .set(...bearer(centerToken));
    const patch = await api()
      .patch(`/api/v1/centers/${id}`)
      .set(...bearer(centerToken))
      .send({ payoutIban: OTHER_IBAN });

    expect(own.status).toBe(200);
    expect(foreign.status).toBe(403);
    expect(patch.status).toBe(403);
  });
});
