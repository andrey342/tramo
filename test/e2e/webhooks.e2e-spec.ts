import { type INestApplication } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { PublishWebhookCommand } from '../../src/modules/notifications/application/commands/publish-webhook.command';
import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

describe('Webhooks (e2e)', () => {
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

  it('should configure a webhook with a secret shown once, and remove it', async () => {
    const { centerId, token } = await centerWithAdmin();

    const configured = await api()
      .put(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(token))
      .send({ url: 'http://webhook-sink:9099/tramo' });
    const read = await api()
      .get(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(opsToken));
    const removed = await api()
      .delete(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(token));
    const afterRemoval = await api()
      .get(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(token));

    expect(configured.status).toBe(200);
    expect(configured.body).toMatchObject({
      centerId,
      url: 'http://webhook-sink:9099/tramo',
      status: 'active',
      secret: expect.stringMatching(/^whsec_[\w-]{43}$/),
    });
    // The secret is shown once: no cache along the way may keep a copy of the answer.
    expect(configured.headers['cache-control']).toBe('no-store');
    expect(read.status).toBe(200);
    expect(read.body).not.toHaveProperty('secret');
    expect(read.body.events).toEqual([
      'application.submitted',
      'application.decided',
      'contract.signed',
      'disbursement.settled',
      'contract.in_arrears',
      'contract.defaulted',
    ]);
    expect(removed.status).toBe(204);
    expect(afterRemoval.status).toBe(404);
    expect(afterRemoval.body.code).toBe('webhook_not_configured');
  });

  it('should keep a center webhook to its own admins, and refuse a bad URL', async () => {
    const { centerId } = await centerWithAdmin();
    const other = await centerWithAdmin();

    const byOtherCenter = await api()
      .put(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(other.token))
      .send({ url: 'https://evil.example/hooks' });
    const byOps = await api()
      .put(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(opsToken))
      .send({ url: 'https://ops.example/hooks' });
    const badUrl = await api()
      .put(`/api/v1/centers/${other.centerId}/webhook`)
      .set(...bearer(other.token))
      .send({ url: 'https://user:secret@center.example/hooks' });
    const listByOther = await api()
      .get(`/api/v1/centers/${centerId}/webhook-deliveries`)
      .set(...bearer(other.token));

    expect(byOtherCenter.status).toBe(403);
    expect(byOtherCenter.body.code).toBe('notifications_access_denied');
    expect(byOps.status).toBe(403);
    expect(badUrl.status).toBe(422);
    expect(badUrl.body.code).toBe('invalid_webhook_url');
    expect(listByOther.status).toBe(403);
  });

  it('should list deliveries and refuse to redeliver one still in progress', async () => {
    const { centerId, token } = await centerWithAdmin();
    await api()
      .put(`/api/v1/centers/${centerId}/webhook`)
      .set(...bearer(token))
      .send({ url: 'http://webhook-sink:9099/tramo' });
    const contractId = uuidv7();
    await app.get(CommandBus).execute(
      new PublishWebhookCommand({
        eventId: uuidv7(),
        centerId,
        event: 'contract.signed',
        occurredAt: new Date(),
        data: { contractId },
      }),
    );

    const page = await api()
      .get(`/api/v1/centers/${centerId}/webhook-deliveries?status=pending&limit=10`)
      .set(...bearer(token));
    const deliveryId = (page.body as { data: { id: string }[] }).data[0]?.id ?? '';
    const redelivery = await api()
      .post(`/api/v1/centers/${centerId}/webhook-deliveries/${deliveryId}/redeliver`)
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());
    const unknown = await api()
      .post(`/api/v1/centers/${centerId}/webhook-deliveries/${uuidv7()}/redeliver`)
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7());

    expect(page.status).toBe(200);
    expect(page.body.data).toEqual([
      expect.objectContaining({
        event: 'contract.signed',
        status: 'pending',
        round: 1,
        attempts: 0,
        data: { contractId },
      }),
    ]);
    expect(redelivery.status).toBe(409);
    expect(redelivery.body.code).toBe('webhook_delivery_in_progress');
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('webhook_delivery_not_found');
  });
});
