import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { aTaxId, VALID_IBAN } from '../factories/catalog';

// Registers a training center through the API as an admin and, unless asked otherwise, verifies
// its VAT number (VIES_MODE=fake in tests) so it is active.
export async function registerCenter(
  app: INestApplication,
  adminToken: string,
  options: { name?: string; activate?: boolean } = {},
): Promise<string> {
  const api = request(app.getHttpServer());
  const created = await api
    .post('/api/v1/centers')
    .set('Authorization', `Bearer ${adminToken}`)
    .set('Idempotency-Key', uuidv7())
    .send({
      name: options.name ?? 'Test School',
      country: 'ES',
      taxId: aTaxId(),
      payoutIban: VALID_IBAN,
      platformFeeBasisPoints: 500,
    });
  if (created.status !== 201) {
    throw new Error(`Center registration failed: ${String(created.status)}`);
  }
  const id = (created.body as { id: string }).id;
  if (options.activate ?? true) {
    await request(app.getHttpServer())
      .post(`/api/v1/centers/${id}/verify-vat`)
      .set('Authorization', `Bearer ${adminToken}`);
  }
  return id;
}
