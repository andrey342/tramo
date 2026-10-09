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
    const response = await request(app.getHttpServer()).get('/api/v1/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('should publish the openapi document', async () => {
    const response = await request(app.getHttpServer()).get('/docs/openapi.json');

    expect(response.status).toBe(200);
    expect(response.body.info.title).toBe('Tramo API');
  });
});
