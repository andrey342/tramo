import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

describe('Center users and API keys (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let centerId: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
    centerId = await registerCenter(app, adminToken);
  });

  afterAll(async () => {
    await app.close();
  });

  async function centerAdminToken(): Promise<string> {
    const email = `center-${uuidv7().slice(-12)}@center.test`;
    const created = await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(adminToken))
      .send({ email, password: TEST_PASSWORD });
    expect(created.status).toBe(201);
    return accessTokenFor(app, { email, password: TEST_PASSWORD });
  }

  it('should let an admin onboard a center administrator, who then belongs to the center', async () => {
    const token = await centerAdminToken();

    const me = await api()
      .get('/api/v1/me')
      .set(...bearer(token));

    expect(me.body).toMatchObject({ roles: ['center_admin'], centerId });
  });

  it('should keep students and center admins away from user creation', async () => {
    const studentEmail = `student-${uuidv7().slice(-12)}@example.com`;
    await api()
      .post('/api/v1/auth/register')
      .send({ email: studentEmail, password: TEST_PASSWORD });
    const studentToken = await accessTokenFor(app, {
      email: studentEmail,
      password: TEST_PASSWORD,
    });

    const asStudent = await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(studentToken))
      .send({ email: 'x@center.test', password: TEST_PASSWORD });
    const centerAdmin = await centerAdminToken();
    const asCenterAdmin = await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(centerAdmin))
      .send({ email: 'y@center.test', password: TEST_PASSWORD });

    expect(asStudent.status).toBe(403);
    expect(asCenterAdmin.status).toBe(403);
  });

  it('should issue an API key once, authenticate with it, and stop accepting it after revocation', async () => {
    const token = await centerAdminToken();

    const issued = await api()
      .post(`/api/v1/centers/${centerId}/api-keys`)
      .set(...bearer(token))
      .send({ name: 'Admissions system', scopes: ['applications:write'] });
    expect(issued.status).toBe(201);
    const key = issued.body.key as string;

    const me = await api().get('/api/v1/me').set('X-Api-Key', key);
    expect(me.body).toEqual({
      kind: 'api_key',
      id: issued.body.id,
      centerId,
      scopes: ['applications:write'],
    });

    const listed = await api()
      .get(`/api/v1/centers/${centerId}/api-keys`)
      .set(...bearer(token));
    expect(listed.body).toEqual([expect.objectContaining({ id: issued.body.id, revokedAt: null })]);
    expect(JSON.stringify(listed.body)).not.toContain(key);

    const revoked = await api()
      .delete(`/api/v1/centers/${centerId}/api-keys/${issued.body.id as string}`)
      .set(...bearer(token));
    expect(revoked.status).toBe(204);

    const afterRevocation = await api().get('/api/v1/me').set('X-Api-Key', key);
    expect(afterRevocation.status).toBe(401);
    expect(afterRevocation.body.code).toBe('invalid_api_key');
  });

  it('should serve parallel requests with the same key', async () => {
    const issued = await api()
      .post(`/api/v1/centers/${centerId}/api-keys`)
      .set(...bearer(adminToken))
      .send({ name: 'Busy integration', scopes: ['applications:read'] });

    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        api()
          .get('/api/v1/me')
          .set('X-Api-Key', issued.body.key as string),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(200));
  });

  it('should keep API keys out of endpoints that do not declare scopes', async () => {
    const issued = await api()
      .post(`/api/v1/centers/${centerId}/api-keys`)
      .set(...bearer(adminToken))
      .send({ name: 'Reporting', scopes: ['portfolio:read'] });

    const response = await api()
      .get(`/api/v1/centers/${centerId}/api-keys`)
      .set('X-Api-Key', issued.body.key as string);

    expect(response.status).toBe(403);
  });

  it('should refuse users and keys for a center that does not exist', async () => {
    const missing = uuidv7();

    const user = await api()
      .post(`/api/v1/centers/${missing}/users`)
      .set(...bearer(adminToken))
      .send({ email: `ghost-${uuidv7().slice(-12)}@center.test`, password: TEST_PASSWORD });
    const key = await api()
      .post(`/api/v1/centers/${missing}/api-keys`)
      .set(...bearer(adminToken))
      .send({ name: 'x', scopes: ['programs:read'] });

    expect(user.status).toBe(404);
    expect(key.status).toBe(404);
  });

  it('should not let a center admin manage another center', async () => {
    const token = await centerAdminToken();

    const response = await api()
      .post(`/api/v1/centers/${uuidv7()}/api-keys`)
      .set(...bearer(token))
      .send({ name: 'x', scopes: ['programs:read'] });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('center_access_denied');
  });

  it('should audit what the admins did', async () => {
    const { DataSource } = await import('typeorm');
    const rows: { action: string }[] = await app
      .get(DataSource)
      .query('SELECT action FROM shared.audit_log WHERE resource_id = $1', [centerId]);

    expect(rows.map((row) => row.action)).toEqual(
      expect.arrayContaining(['center_user.create', 'api_key.issue']),
    );
  });
});
