import { type INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApiApp } from '../helpers/create-api-app';

const PASSWORD = 'correct horse battery staple';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());
  const uniqueEmail = (label: string): string =>
    `${label}.${String(Date.now())}.${String(Math.random()).slice(2, 8)}@example.com`;

  beforeAll(async () => {
    app = await createApiApp();
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndLogin(email: string) {
    const registered = await api()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD });
    expect(registered.status).toBe(201);
    const login = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.headers['cache-control']).toBe('no-store');
    return { userId: registered.body.userId as string, tokens: login.body };
  }

  it('should register, sign in and identify the student', async () => {
    const email = uniqueEmail('ana');
    const { userId, tokens } = await registerAndLogin(email);

    expect(tokens).toMatchObject({ tokenType: 'Bearer', expiresIn: 900 });
    const me = await api().get('/api/v1/me').set('Authorization', `Bearer ${tokens.accessToken}`);

    expect(me.status).toBe(200);
    expect(me.body).toEqual({
      kind: 'user',
      id: userId,
      email,
      roles: ['student'],
      centerId: null,
    });
  });

  it('should reject a duplicate registration with a stable problem code', async () => {
    const email = uniqueEmail('dup');
    await api().post('/api/v1/auth/register').send({ email, password: PASSWORD });

    const again = await api()
      .post('/api/v1/auth/register')
      .send({ email: email.toUpperCase(), password: PASSWORD });

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('email_already_registered');
  });

  it('should validate the registration body', async () => {
    const response = await api()
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', password: 'short', role: 'admin' });

    expect(response.status).toBe(400);
    const fields = (response.body.errors as { field: string }[]).map((error) => error.field);
    expect(fields.sort()).toEqual(['email', 'password', 'role']);
  });

  it('should require a bearer token on protected routes', async () => {
    const anonymous = await api().get('/api/v1/me');
    const forged = await api().get('/api/v1/me').set('Authorization', 'Bearer not.a.token');

    expect(anonymous.status).toBe(401);
    expect(anonymous.headers['www-authenticate']).toBe('Bearer');
    expect(anonymous.body.code).toBe('unauthenticated');
    expect(forged.status).toBe(401);
  });

  it('should rotate refresh tokens and reject the old one', async () => {
    const { tokens } = await registerAndLogin(uniqueEmail('rotate'));

    const rotated = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(tokens.refreshToken);

    const replay = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe('invalid_refresh_token');
    // Revoking the family when an old token comes back after the grace window is covered by the
    // unit tests, which control the clock.
  });

  it('should let one of two simultaneous refreshes win without ending the session', async () => {
    const { tokens } = await registerAndLogin(uniqueEmail('race'));

    const results = await Promise.all([
      api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }),
      api().post('/api/v1/auth/refresh').send({ refreshToken: tokens.refreshToken }),
    ]);

    const statuses = results.map((response) => response.status).sort();
    expect(statuses).toContain(200);
    expect(statuses.every((status) => status === 200 || status === 401)).toBe(true);
    const winner = results.find((response) => response.status === 200);
    const next = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: winner?.body.refreshToken as string });
    expect(next.status).toBe(200);
  });

  it('should end the session on logout', async () => {
    const { tokens } = await registerAndLogin(uniqueEmail('logout'));

    const logout = await api()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: tokens.refreshToken });
    const refresh = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: tokens.refreshToken });

    expect(logout.status).toBe(204);
    expect(refresh.status).toBe(401);
  });

  it('should give the same answer for unknown emails and wrong passwords, then lock the account', async () => {
    const email = uniqueEmail('lock');
    await api().post('/api/v1/auth/register').send({ email, password: PASSWORD });

    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ email: uniqueEmail('ghost'), password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.code).toBe('invalid_credentials');

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrong = await api()
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong password!!' });
      expect(wrong.body.code).toBe('invalid_credentials');
    }
    const locked = await api().post('/api/v1/auth/login').send({ email, password: PASSWORD });

    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('account_temporarily_locked');
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });
});
