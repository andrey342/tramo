import { type INestApplication } from '@nestjs/common';
import request from 'supertest';

import { createApiApp } from '../helpers/create-api-app';

describe('Metrics (e2e)', () => {
  let app: INestApplication;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createApiApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should answer only a bearer of the metrics token', async () => {
    const anonymous = await api().get('/metrics');
    const wrong = await api().get('/metrics').set('Authorization', 'Bearer not-the-token');

    expect(anonymous.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(wrong.text).toBe('');
  });

  it('should not serve metrics at all without a configured token', async () => {
    const token = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = '';
    const untokened = await createApiApp().finally(() => {
      process.env.METRICS_TOKEN = token;
    });
    try {
      const scrape = await request(untokened.getHttpServer())
        .get('/metrics')
        .set('Authorization', `Bearer ${token ?? ''}`);

      expect(scrape.status).toBe(404);
    } finally {
      await untokened.close();
    }
  });

  it('should report request latency by route template, the queues and the outbox', async () => {
    await api().get('/api/v1/programs/0199c1d2-0000-7000-8000-000000000000');
    await api().get('/api/v1/no-such-route/42');

    const scrape = await api()
      .get('/metrics')
      .set('Authorization', 'Bearer test-metrics-token-of-at-least-32-chars');

    expect(scrape.status).toBe(200);
    expect(scrape.headers['content-type']).toMatch(/^text\/plain/);
    expect(scrape.text).toMatch(
      /tramo_http_request_duration_seconds_count\{method="GET",route="\/api\/v1\/programs\/:programId",status_code="404"\} \d+/,
    );
    expect(scrape.text).toMatch(/route="unmatched",status_code="404"/);
    expect(scrape.text).not.toContain('no-such-route');
    expect(scrape.text).toMatch(/tramo_queue_jobs\{queue="events.billing",state="waiting"\} \d+/);
    expect(scrape.text).toMatch(/tramo_outbox_pending_events \d+/);
    expect(scrape.text).toMatch(/tramo_outbox_lag_seconds [\d.]+/);
    expect(scrape.text).toContain('tramo_process_cpu_seconds_total');
  });
});
