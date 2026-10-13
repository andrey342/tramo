import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

// A published program of the center, financed in 12 instalments, created through the API by
// someone who may manage the center (its admin, or a staff admin).
export async function publishProgram(
  app: INestApplication,
  token: string,
  centerId: string,
  name = 'Data Bootcamp',
): Promise<string> {
  const api = () => request(app.getHttpServer());
  const created = await api()
    .post(`/api/v1/centers/${centerId}/programs`)
    .set('Authorization', `Bearer ${token}`)
    .set('Idempotency-Key', uuidv7())
    .send({
      name,
      modality: 'online',
      priceCents: 6_000_00,
      durationWeeks: 12,
      startDates: ['2027-01-11'],
      employabilityRateBasisPoints: 8_000,
      avgStartingSalaryCents: 26_000_00,
      financing: { installments: { allowedTerms: [12], annualRateBasisPoints: 900 } },
    });
  if (created.status !== 201) {
    throw new Error(`Program creation failed: ${String(created.status)}`);
  }
  const id = (created.body as { id: string }).id;
  await api()
    .patch(`/api/v1/programs/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status: 'published' })
    .expect(200);
  return id;
}
