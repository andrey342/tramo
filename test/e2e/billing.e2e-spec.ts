import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import {
  type Charge,
  CHARGE_REPOSITORY,
  type ChargeRepository,
} from '../../src/modules/billing/domain';
import {
  type Contract,
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../src/modules/lending/domain';
import { UNIT_OF_WORK, type UnitOfWork } from '../../src/shared/application';
import { CalendarDate } from '../../src/shared/domain';
import { signWebhook } from '../../src/shared/infrastructure/http';
import { STUDENT_IBAN } from '../factories/billing';
import { anActiveContract, anIsa, aPlan } from '../factories/lending';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

const PSP_SECRET = 'test-psp-webhook-secret-of-32-characters!';

describe('Billing (e2e)', () => {
  let app: INestApplication;
  let opsToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    opsToken = await accessTokenFor(app, await createStaffUser(app, 'ops'));
  });

  afterAll(async () => {
    await app.close();
  });

  // A registered student with an active contract activated today (24 instalments, or an ISA),
  // as lending leaves it once the center is paid.
  async function studentWithContract(isa = false) {
    const email = `payer-${uuidv7().slice(-12)}@example.com`;
    await api().post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD });
    const token = await accessTokenFor(app, { email, password: TEST_PASSWORD });
    const studentId = (
      await api()
        .get('/api/v1/me')
        .set(...bearer(token))
    ).body.id as string;
    const today = CalendarDate.fromInstant(new Date());
    const contract: Contract = anActiveContract({
      studentId,
      terms: isa ? { product: anIsa() } : {},
    });
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await app.get<ContractRepository>(CONTRACT_REPOSITORY).save(contract);
      await app.get<FinancingPlanRepository>(FINANCING_PLAN_REPOSITORY).save(
        aPlan({
          contractId: contract.id,
          activatedOn: today.toString(),
          ...(isa ? { product: anIsa() } : {}),
        }),
      );
    });
    const firstDue = today.addMonths(1).withDay(Math.min(today.day, 28));
    return { token, contractId: contract.id, firstDue };
  }

  const callback = (body: object, secret = PSP_SECRET) => {
    const raw = JSON.stringify(body);
    return api()
      .post('/api/v1/webhooks/psp')
      .set('Content-Type', 'application/json')
      .set('X-Psp-Signature', signWebhook(secret, raw, new Date()))
      .send(raw);
  };

  const chargeOf = (contractId: string, reference: string): Promise<Charge | null> =>
    app.get<ChargeRepository>(CHARGE_REPOSITORY).findByReference(contractId, reference);

  it('should take a mandate, bill and collect an instalment, and record the payment', async () => {
    const { token, contractId, firstDue } = await studentWithContract();

    const mandate = await api()
      .post(`/api/v1/contracts/${contractId}/mandate`)
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7())
      .send({ iban: STUDENT_IBAN });
    const run = await api()
      .post(`/api/v1/ops/billing/run?asOf=${firstDue.toString()}&contractId=${contractId}`)
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());
    const pending = await chargeOf(contractId, 'installment:1');
    const reference = pending?.currentAttempt?.key ?? '';
    const paid = await callback({
      eventId: uuidv7(),
      type: 'payment.succeeded',
      paymentId: 'psp-1',
      reference,
      occurredAt: new Date().toISOString(),
    });
    const replayed = await callback({
      eventId: uuidv7(),
      type: 'payment.succeeded',
      paymentId: 'psp-1',
      reference,
      occurredAt: new Date().toISOString(),
    });
    const charges = await api()
      .get(`/api/v1/contracts/${contractId}/charges`)
      .set(...bearer(token));
    const statement = await api()
      .get(`/api/v1/contracts/${contractId}/statement`)
      .set(...bearer(token));
    const retryPaid = await api()
      .post(`/api/v1/charges/${pending?.id ?? ''}/retry`)
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());

    expect(mandate.status).toBe(201);
    expect(mandate.body).toMatchObject({
      status: 'active',
      ibanMasked: expect.stringMatching(/5766$/),
    });
    expect(JSON.stringify(mandate.body)).not.toContain(STUDENT_IBAN);
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({
      plansBilled: 1,
      chargesCreated: 1,
      collectionsSubmitted: 1,
      failedContractIds: [],
      failedChargeIds: [],
    });
    expect(pending?.status).toBe('pending');
    expect(paid.status).toBe(200);
    expect(paid.body).toEqual({ id: pending?.id, status: 'paid' });
    expect(replayed.body.status).toBe('paid');
    expect(charges.body.data).toEqual([
      expect.objectContaining({ kind: 'installment', installmentNumber: 1, status: 'paid' }),
    ]);
    expect(statement.status).toBe(200);
    expect(statement.body).toMatchObject({ contractId, balanceCents: expect.any(Number) });
    expect(retryPaid.status).toBe(409);
  });

  it('should refuse provider callbacks that are unsigned, signed with another key, or unknown', async () => {
    const body = {
      eventId: uuidv7(),
      type: 'payment.failed',
      paymentId: 'psp-x',
      reference: `${uuidv7()}.1`,
      failureReason: 'insufficient_funds',
      occurredAt: new Date().toISOString(),
    };

    const unsigned = await api().post('/api/v1/webhooks/psp').send(body);
    const otherKey = await callback(body, 'another-secret-of-at-least-32-characters');
    const unknown = await callback(body);
    const malformed = await callback({ ...body, reference: 'installment:1' });

    expect(unsigned.status).toBe(401);
    expect(otherKey.status).toBe(401);
    expect(otherKey.body.code).toBe('invalid_webhook_signature');
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe('unknown_collection_attempt');
    expect(malformed.status).toBe(400);
  });

  it('should take income declarations for an ISA, once a month', async () => {
    const isa = await studentWithContract(true);
    const loan = await studentWithContract();
    const period = CalendarDate.fromInstant(new Date()).period;
    const declare = (token: string, contractId: string, month: string) =>
      api()
        .post(`/api/v1/contracts/${contractId}/income-declarations`)
        .set(...bearer(token))
        .set('Idempotency-Key', uuidv7())
        .send({ period: month, grossMonthlyIncomeCents: 2_150_00 });

    const declared = await declare(isa.token, isa.contractId, period);
    const twice = await declare(isa.token, isa.contractId, period);
    const notIsa = await declare(loan.token, loan.contractId, period);
    const future = await declare(isa.token, isa.contractId, '2099-01');

    expect(declared.status).toBe(201);
    expect(declared.body).toMatchObject({
      period,
      grossMonthlyIncomeCents: 2_150_00,
      source: 'self',
    });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('income_already_declared');
    expect(notIsa.body.code).toBe('not_an_income_share');
    expect(future.body.code).toBe('invalid_period');
  });

  it('should keep billing to the student and staff', async () => {
    const { token, contractId } = await studentWithContract();
    const other = await studentWithContract();

    const strangerCharges = await api()
      .get(`/api/v1/contracts/${contractId}/charges`)
      .set(...bearer(other.token));
    const strangerMandate = await api()
      .post(`/api/v1/contracts/${contractId}/mandate`)
      .set(...bearer(other.token))
      .set('Idempotency-Key', uuidv7())
      .send({ iban: STUDENT_IBAN });
    const studentRun = await api()
      .post('/api/v1/ops/dunning/run')
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7());
    const opsRun = await api()
      .post(`/api/v1/ops/dunning/run?asOf=2026-11-13&contractId=${contractId}`)
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());
    const badAsOf = await api()
      .post('/api/v1/ops/billing/run?asOf=tomorrow')
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());
    const noKey = await api()
      .post('/api/v1/ops/billing/run')
      .set(...bearer(opsToken));

    expect(strangerCharges.status).toBe(404);
    expect(strangerMandate.status).toBe(404);
    expect(studentRun.status).toBe(403);
    expect(opsRun.status).toBe(200);
    expect(opsRun.body).toEqual({
      asOf: '2026-11-13',
      chargesReviewed: 0,
      retries: 0,
      failedChargeIds: [],
    });
    expect(badAsOf.status).toBe(400);
    expect(noKey.status).toBe(400);
  });
});
