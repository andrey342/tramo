import { type INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApiApp } from '../helpers/create-api-app';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApiApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should report liveness without touching dependencies', async () => {
    const response = await request(app.getHttpServer()).get('/health/live');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('should report readiness when postgres and redis answer', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(200);
    expect(response.body.info).toMatchObject({
      database: { status: 'up' },
      redis: { status: 'up' },
    });
  });

  it('should serve versioned routes under /api/v1 and answer unknown ones with problem details', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist?email=a@b.c');

    expect(response.status).toBe(404);
    expect(response.body.detail).toBe('No route matches GET /api/v1/does-not-exist.');
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  // Outside the prefix, a body the parser refuses and a malformed id in the path: still problem
  // details, with the request id.
  it('should answer every error with problem details and a request id', async () => {
    const server = app.getHttpServer();
    const outside = await request(server).get('/nope');
    const malformed = await request(server)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    const badId = await request(server).get('/api/v1/programs/not-a-uuid');
    const tooLarge = await request(server)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a'.repeat(2_000_000) }));

    expect(outside.status).toBe(404);
    expect(outside.body).toMatchObject({ code: 'not_found', instance: '/nope' });
    expect(malformed.status).toBe(400);
    expect(malformed.body).toMatchObject({
      code: 'malformed_body',
      title: 'Malformed body',
      detail: 'The request body is not valid JSON.',
    });
    expect(badId.status).toBe(400);
    expect(badId.body).toMatchObject({
      code: 'validation_error',
      errors: [{ field: 'programId', message: 'programId must be a UUID' }],
    });
    const plainText = await request(server)
      .post('/api/v1/auth/register')
      .set('Content-Type', 'text/plain')
      .send('{"email":"a@b.c","password":"x"}');
    const form = await request(server)
      .post('/api/v1/auth/register')
      .type('form')
      .send({ email: `form-${String(Date.now())}@example.com`, password: 'Str0ng-passw0rd!' });
    expect(plainText.status).toBe(415);
    expect(form.status).toBe(415);
    expect(form.body.code).toBe('unsupported_media_type');
    expect(tooLarge.status).toBe(413);
    expect(tooLarge.body.code).toBe('payload_too_large');
    for (const response of [outside, malformed, badId, tooLarge, plainText, form]) {
      expect(response.headers['content-type']).toContain('application/problem+json');
      expect(response.body.requestId).toEqual(response.headers['x-request-id']);
    }
  });

  it('should publish the openapi document', async () => {
    const response = await request(app.getHttpServer()).get('/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.info.title).toBe('Tramo API');
  });
});
