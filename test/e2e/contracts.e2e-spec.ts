import { createHash } from 'node:crypto';

import { type INestApplication } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { ActivateContractCommand } from '../../src/modules/lending/application/commands/activate-contract.command';
import { CheckDisbursementSettlementCommand } from '../../src/modules/lending/application/commands/check-disbursement-settlement.command';
import { DrawUpContractCommand } from '../../src/modules/lending/application/commands/draw-up-contract.command';
import { ExecuteDisbursementCommand } from '../../src/modules/lending/application/commands/execute-disbursement.command';
import { OpenFinancingPlanCommand } from '../../src/modules/lending/application/commands/open-financing-plan.command';
import { RequestDisbursementCommand } from '../../src/modules/lending/application/commands/request-disbursement.command';
import { SendContractForSignatureCommand } from '../../src/modules/lending/application/commands/send-contract-for-signature.command';
import { RunVerificationCommand } from '../../src/modules/origination/application/commands/run-verification.command';
import { ScoreApplicationCommand } from '../../src/modules/origination/application/commands/score-application.command';
import { Percentage } from '../../src/shared/domain';
import { signWebhook } from '../../src/shared/infrastructure/http';
import { registerCenter } from '../helpers/centers';
import { createApiApp } from '../helpers/create-api-app';
import { accessTokenFor, createStaffUser, TEST_PASSWORD } from '../helpers/users';

const ESIGN_SECRET = 'test-esign-webhook-secret-of-32-characters';
const PROFILE = {
  dateOfBirth: '1998-05-20',
  nationalId: '56781234F',
  residenceCountry: 'ES',
  declaredMonthlyIncomeCents: 180_000,
  employmentStatus: 'employed',
};

describe('Contracts (e2e)', () => {
  let app: INestApplication;
  let commands: CommandBus;
  let opsToken: string;
  let centerToken: string;
  let centerId: string;
  let programId: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    commands = app.get(CommandBus);
    const adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
    opsToken = await accessTokenFor(app, await createStaffUser(app, 'ops'));
    centerId = await registerCenter(app, adminToken, { name: 'Lending School' });
    const centerEmail = `lending-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(adminToken))
      .send({ email: centerEmail, password: TEST_PASSWORD });
    centerToken = await accessTokenFor(app, { email: centerEmail, password: TEST_PASSWORD });
    const program = await api()
      .post(`/api/v1/centers/${centerId}/programs`)
      .set(...bearer(centerToken))
      .set('Idempotency-Key', uuidv7())
      .send({
        name: 'Cloud Bootcamp',
        modality: 'online',
        priceCents: 600_000,
        durationWeeks: 12,
        startDates: ['2027-01-11'],
        employabilityRateBasisPoints: 8_500,
        avgStartingSalaryCents: 2_800_000,
        financing: { installments: { allowedTerms: [12], annualRateBasisPoints: 900 } },
      });
    programId = program.body.id as string;
    await api()
      .patch(`/api/v1/programs/${programId}`)
      .set(...bearer(centerToken))
      .send({ status: 'published' });
  });

  afterAll(async () => {
    await app.close();
  });

  // A student with an accepted offer, and the contract the worker would draw up and send for it
  // (the api process runs the same commands).
  async function contractSentForSignature(): Promise<{ token: string; contractId: string }> {
    const email = `borrower-${uuidv7().slice(-12)}@example.com`;
    await api().post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD });
    const token = await accessTokenFor(app, { email, password: TEST_PASSWORD });
    const draft = await api()
      .post('/api/v1/applications')
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7())
      .send({ programId, product: { kind: 'installments', termMonths: 12 }, profile: PROFILE });
    const applicationId = draft.body.id as string;
    await api()
      .post(`/api/v1/applications/${applicationId}/submit`)
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7());
    for (const type of ['kyc', 'employment', 'bureau'] as const) {
      await commands.execute(new RunVerificationCommand(applicationId, type));
    }
    await commands.execute(new ScoreApplicationCommand(applicationId));
    const accepted = await api()
      .post(`/api/v1/applications/${applicationId}/accept-offer`)
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7());
    expect(accepted.body.status).toBe('offer_accepted');
    const userId = (
      await api()
        .get('/api/v1/me')
        .set(...bearer(token))
    ).body.id as string;
    const contractId = await commands.execute(
      new DrawUpContractCommand({
        applicationId,
        studentId: userId,
        centerId,
        programId,
        programName: 'Cloud Bootcamp',
        principalCents: 600_000,
        product: {
          kind: 'installments',
          termMonths: 12,
          annualRate: Percentage.fromBasisPoints(900),
        },
      }),
    );
    await commands.execute(new SendContractForSignatureCommand(contractId));
    return { token, contractId };
  }

  const callback = (body: object, signedAt = new Date(), secret = ESIGN_SECRET) => {
    const raw = JSON.stringify(body);
    return api()
      .post('/api/v1/webhooks/esign')
      .set('Content-Type', 'application/json')
      .set('X-Esign-Signature', signWebhook(secret, raw, signedAt))
      .send(raw);
  };

  async function activate(contractId: string): Promise<void> {
    await commands.execute(new RequestDisbursementCommand(contractId));
    const disbursements = await api()
      .get('/api/v1/ops/disbursements')
      .set(...bearer(opsToken));
    const disbursement = (disbursements.body.data as { id: string; contractId: string }[]).find(
      (item) => item.contractId === contractId,
    );
    await commands.execute(new ExecuteDisbursementCommand(disbursement!.id));
    await commands.execute(new CheckDisbursementSettlementCommand(disbursement!.id));
    await commands.execute(new ActivateContractCommand(contractId));
    await commands.execute(new OpenFinancingPlanCommand(contractId));
  }

  it('should take an accepted offer through signature to an active plan with a payoff', async () => {
    const { token, contractId } = await contractSentForSignature();
    const sent = await api()
      .get(`/api/v1/contracts/${contractId}`)
      .set(...bearer(token));
    const document = await api()
      .get(`/api/v1/contracts/${contractId}/document`)
      .set(...bearer(token));

    const signed = await callback({
      eventId: uuidv7(),
      type: 'envelope.completed',
      envelopeId: sent.body.signature.envelopeId,
      documentHash: createHash('sha256').update(document.text).digest('hex'),
      occurredAt: new Date().toISOString(),
    });
    await activate(contractId);
    const asStudent = await api()
      .get(`/api/v1/contracts/${contractId}`)
      .set(...bearer(token));
    const asCenter = await api()
      .get(`/api/v1/contracts/${contractId}`)
      .set(...bearer(centerToken));
    const schedule = await api()
      .get(`/api/v1/contracts/${contractId}/schedule`)
      .set(...bearer(token));
    const quote = await api()
      .post(`/api/v1/contracts/${contractId}/payoff-quote`)
      .set(...bearer(token))
      .send({});
    const payoff = await api()
      .post(`/api/v1/contracts/${contractId}/payoff`)
      .set(...bearer(token))
      .set('Idempotency-Key', uuidv7())
      .send({ amountCents: quote.body.totalCents });

    expect(sent.body).toMatchObject({ status: 'sent_for_signature', payout: null });
    expect(document.headers['content-type']).toMatch(/^text\/plain/);
    expect(createHash('sha256').update(document.text).digest('hex')).toBe(
      sent.body.signature.documentHash,
    );
    expect(signed.status).toBe(204);
    expect(asStudent.body).toMatchObject({
      status: 'active',
      principalCents: 600_000,
      product: { kind: 'installments', termMonths: 12, aprBasisPoints: 938 },
      payout: null,
    });
    expect(asCenter.body.payout).toMatchObject({
      platformFeeBasisPoints: 500,
      disbursementAmountCents: 570_000,
      disbursementStatus: 'settled',
    });
    expect(schedule.status).toBe(200);
    expect(schedule.body.installments).toHaveLength(12);
    expect(quote.body).toMatchObject({ totalCents: 600_000, overdueInstallments: 0 });
    expect(payoff.status).toBe(200);
  });

  it('should refuse callbacks that are unsigned, tampered with, stale or signed with another key', async () => {
    const { contractId } = await contractSentForSignature();
    const body = {
      eventId: uuidv7(),
      type: 'envelope.declined',
      envelopeId: `sim-env-${contractId}`,
      occurredAt: new Date().toISOString(),
    };

    const unsigned = await api().post('/api/v1/webhooks/esign').send(body);
    const tampered = await api()
      .post('/api/v1/webhooks/esign')
      .set('Content-Type', 'application/json')
      .set('X-Esign-Signature', signWebhook(ESIGN_SECRET, JSON.stringify(body), new Date()))
      .send(JSON.stringify({ ...body, type: 'envelope.completed' }));
    const stale = await callback(body, new Date(Date.now() - 10 * 60 * 1000));
    const otherKey = await callback(body, new Date(), 'another-secret-of-at-least-32-characters');
    const declined = await callback(body);
    const replayed = await callback(body);

    for (const refused of [unsigned, tampered, stale, otherKey]) {
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('invalid_webhook_signature');
    }
    expect(declined.status).toBe(204);
    expect(replayed.status).toBe(204);
  });

  it('should refuse a signature over another document, and an unknown envelope', async () => {
    const { contractId } = await contractSentForSignature();

    const forged = await callback({
      eventId: uuidv7(),
      type: 'envelope.completed',
      envelopeId: `sim-env-${contractId}`,
      documentHash: 'f'.repeat(64),
      occurredAt: new Date().toISOString(),
    });
    const unknown = await callback({
      eventId: uuidv7(),
      type: 'envelope.declined',
      envelopeId: 'sim-env-unknown',
      occurredAt: new Date().toISOString(),
    });
    const incomplete = await callback({
      eventId: uuidv7(),
      type: 'envelope.completed',
      envelopeId: `sim-env-${contractId}`,
      occurredAt: new Date().toISOString(),
    });

    expect(forged.status).toBe(422);
    expect(forged.body.code).toBe('signature_mismatch');
    expect(unknown.status).toBe(404);
    expect(incomplete.status).toBe(400);
  });

  it('should keep repayment and payout to the right people', async () => {
    const { token, contractId } = await contractSentForSignature();
    const email = `other-${uuidv7().slice(-12)}@example.com`;
    await api().post('/api/v1/auth/register').send({ email, password: TEST_PASSWORD });
    const otherStudent = await accessTokenFor(app, { email, password: TEST_PASSWORD });

    const centerDocument = await api()
      .get(`/api/v1/contracts/${contractId}/document`)
      .set(...bearer(centerToken));
    const otherView = await api()
      .get(`/api/v1/contracts/${contractId}`)
      .set(...bearer(otherStudent));
    const studentList = await api()
      .get('/api/v1/contracts')
      .set(...bearer(token));
    const studentOps = await api()
      .get('/api/v1/ops/disbursements')
      .set(...bearer(token));
    const badQuote = await api()
      .post(`/api/v1/contracts/${contractId}/payoff-quote`)
      .set(...bearer(token))
      .send({ asOf: 'tomorrow' });

    expect(centerDocument.status).toBe(403);
    expect(otherView.status).toBe(404);
    expect((studentList.body.data as { id: string }[]).map((c) => c.id)).toEqual([contractId]);
    expect(studentOps.status).toBe(403);
    expect(badQuote.status).toBe(400);
  });

  it('should let ops retry only a failed disbursement', async () => {
    const { token, contractId } = await contractSentForSignature();
    const sent = await api()
      .get(`/api/v1/contracts/${contractId}`)
      .set(...bearer(token));
    const document = await api()
      .get(`/api/v1/contracts/${contractId}/document`)
      .set(...bearer(token));
    await callback({
      eventId: uuidv7(),
      type: 'envelope.completed',
      envelopeId: sent.body.signature.envelopeId,
      documentHash: createHash('sha256').update(document.text).digest('hex'),
      occurredAt: new Date().toISOString(),
    });
    await activate(contractId);
    const page = await api()
      .get('/api/v1/ops/disbursements?status=settled')
      .set(...bearer(opsToken));
    const settled = (page.body.data as { id: string; contractId: string }[]).find(
      (item) => item.contractId === contractId,
    );

    const retry = await api()
      .post(`/api/v1/ops/disbursements/${settled!.id}/retry`)
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());

    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('invalid_state_transition');
  });
});
