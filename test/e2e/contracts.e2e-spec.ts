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
import { RecordContractOutcomeCommand } from '../../src/modules/origination/application/commands/record-contract-outcome.command';
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
  let adminToken: string;
  let opsToken: string;
  let centerToken: string;
  let centerId: string;
  let programId: string;
  const api = () => request(app.getHttpServer());
  const bearer = (token: string): [string, string] => ['Authorization', `Bearer ${token}`];

  beforeAll(async () => {
    app = await createApiApp();
    commands = app.get(CommandBus);
    adminToken = await accessTokenFor(app, await createStaffUser(app, 'admin'));
    opsToken = await accessTokenFor(app, await createStaffUser(app, 'ops'));
    ({ centerId, centerToken, programId } = await centerWithProgram('Lending School'));
  });

  afterAll(async () => {
    await app.close();
  });

  // An active center with an admin and a published program it finances in 12 instalments.
  async function centerWithProgram(name: string): Promise<{
    centerId: string;
    centerToken: string;
    programId: string;
  }> {
    const centerId = await registerCenter(app, adminToken, { name });
    const centerEmail = `lending-${uuidv7().slice(-12)}@center.test`;
    await api()
      .post(`/api/v1/centers/${centerId}/users`)
      .set(...bearer(adminToken))
      .send({ email: centerEmail, password: TEST_PASSWORD });
    const centerToken = await accessTokenFor(app, { email: centerEmail, password: TEST_PASSWORD });
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
    const programId = program.body.id as string;
    await api()
      .patch(`/api/v1/programs/${programId}`)
      .set(...bearer(centerToken))
      .send({ status: 'published' });
    return { centerId, centerToken, programId };
  }

  // A student with an accepted offer, and the contract the worker would draw up and send for it
  // (the api process runs the same commands).
  async function contractSentForSignature(
    at: { centerId: string; programId: string } = { centerId, programId },
  ): Promise<{
    token: string;
    contractId: string;
    applicationId: string;
  }> {
    const { centerId, programId } = at;
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
    return { token, contractId, applicationId };
  }

  const callback = (body: object, signedAt = new Date(), secret = ESIGN_SECRET) => {
    const raw = JSON.stringify(body);
    return api()
      .post('/api/v1/webhooks/esign')
      .set('Content-Type', 'application/json')
      .set('X-Esign-Signature', signWebhook(secret, raw, signedAt))
      .send(raw);
  };

  // The provider's callback once the student signed the document they were sent.
  async function sign(token: string, contractId: string): Promise<request.Response> {
    const sent = await api()
      .get(`/api/v1/contracts/${contractId}`)
      .set(...bearer(token));
    const document = await api()
      .get(`/api/v1/contracts/${contractId}/document`)
      .set(...bearer(token));
    return callback({
      eventId: uuidv7(),
      type: 'envelope.completed',
      envelopeId: sent.body.signature.envelopeId,
      documentHash: createHash('sha256').update(document.text).digest('hex'),
      occurredAt: new Date().toISOString(),
    });
  }

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
    // The simulated bank settles at once: the transfer settled just now.
    await commands.execute(new ActivateContractCommand(contractId, new Date()));
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
    expect(signed.status).toBe(200);
    expect(signed.body).toEqual({ id: contractId, status: 'signed' });
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
    expect(declined.status).toBe(200);
    expect(declined.body.status).toBe('cancelled');
    expect(replayed.status).toBe(200);
  });

  it('should let the student apply for the program again when they decline the contract', async () => {
    const { token, contractId, applicationId } = await contractSentForSignature();
    const apply = () =>
      api()
        .post('/api/v1/applications')
        .set(...bearer(token))
        .set('Idempotency-Key', uuidv7())
        .send({ programId, product: { kind: 'installments', termMonths: 12 }, profile: PROFILE });

    const whileHeld = await apply();
    const declined = await callback({
      eventId: uuidv7(),
      type: 'envelope.declined',
      envelopeId: `sim-env-${contractId}`,
      occurredAt: new Date().toISOString(),
    });
    // The worker's consumer of ContractCancelled runs this; the api process runs the same command.
    await commands.execute(new RecordContractOutcomeCommand(applicationId, 'cancelled'));
    const withdrawn = await api()
      .get(`/api/v1/applications/${applicationId}`)
      .set(...bearer(token));
    const again = await apply();

    expect(whileHeld.status).toBe(409);
    expect(whileHeld.body.code).toBe('application_already_open');
    expect(declined.body.status).toBe('cancelled');
    expect(withdrawn.body.status).toBe('withdrawn');
    expect(again.status).toBe(201);
    expect(again.body.status).toBe('draft');
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
    expect(unknown.status).toBe(409);
    expect(unknown.body.code).toBe('envelope_not_recorded');
    expect(incomplete.status).toBe(400);
  });

  // Providers retry anything but a success: a callback that lost the race to another outcome is
  // answered with the contract as it is, not a conflict retried for ever.
  it('should answer a callback about an envelope settled earlier with the contract as it is', async () => {
    const declinedFirst = await contractSentForSignature();
    const signedFirst = await contractSentForSignature();
    const late = (contractId: string, type: string) =>
      callback({
        eventId: uuidv7(),
        type,
        envelopeId: `sim-env-${contractId}`,
        documentHash: 'f'.repeat(64),
        occurredAt: new Date().toISOString(),
      });
    await late(declinedFirst.contractId, 'envelope.declined');
    await sign(signedFirst.token, signedFirst.contractId);

    const completedAfterDecline = await late(declinedFirst.contractId, 'envelope.completed');
    const expiredAfterSigning = await late(signedFirst.contractId, 'envelope.expired');
    const declined = await api()
      .get(`/api/v1/contracts/${declinedFirst.contractId}`)
      .set(...bearer(opsToken));
    const signed = await api()
      .get(`/api/v1/contracts/${signedFirst.contractId}`)
      .set(...bearer(opsToken));

    expect(completedAfterDecline.status).toBe(200);
    expect(completedAfterDecline.body).toEqual({
      id: declinedFirst.contractId,
      status: 'cancelled',
    });
    expect(expiredAfterSigning.status).toBe(200);
    expect(expiredAfterSigning.body).toEqual({ id: signedFirst.contractId, status: 'signed' });
    expect(declined.body).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'signature_declined',
      signature: { signedAt: null },
    });
    expect(signed.body).toMatchObject({ status: 'signed', cancellationReason: null });
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

  // The center closed after the student signed: the disbursement cannot be paid, and only
  // cancelling the contract frees the student's application.
  it('should let ops cancel a signed contract whose disbursement failed, and free the application', async () => {
    const closing = await centerWithProgram('Closing School');
    const { token, contractId, applicationId } = await contractSentForSignature(closing);
    await sign(token, contractId);
    await commands.execute(new RequestDisbursementCommand(contractId));
    const cancel = (as: string, id = contractId) =>
      api()
        .post(`/api/v1/ops/contracts/${id}/cancel`)
        .set(...bearer(as));

    const whilePending = await cancel(opsToken);
    await api()
      .patch(`/api/v1/centers/${closing.centerId}`)
      .set(...bearer(adminToken))
      .send({ status: 'suspended', suspensionReason: 'Closed down' });
    const page = await api()
      .get('/api/v1/ops/disbursements?status=pending')
      .set(...bearer(opsToken));
    const disbursement = (page.body.data as { id: string; contractId: string }[]).find(
      (item) => item.contractId === contractId,
    );
    await commands.execute(new ExecuteDisbursementCommand(disbursement!.id));
    const asCenter = await cancel(closing.centerToken);
    const asStudent = await cancel(token);
    const unknown = await cancel(opsToken, uuidv7());
    const cancelled = await cancel(opsToken);
    const again = await cancel(opsToken);
    const retry = await api()
      .post(`/api/v1/ops/disbursements/${disbursement!.id}/retry`)
      .set(...bearer(opsToken))
      .set('Idempotency-Key', uuidv7());
    // The worker's consumer of ContractCancelled runs this; the api process runs the same command.
    await commands.execute(new RecordContractOutcomeCommand(applicationId, 'cancelled'));
    const application = await api()
      .get(`/api/v1/applications/${applicationId}`)
      .set(...bearer(token));

    expect(whilePending.status).toBe(409);
    expect(whilePending.body.code).toBe('disbursement_not_failed');
    expect(asCenter.status).toBe(403);
    expect(asStudent.status).toBe(403);
    expect(unknown.status).toBe(404);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      id: contractId,
      status: 'cancelled',
      cancellationReason: 'disbursement_failed',
      activatedOn: null,
      payout: { disbursementStatus: 'cancelled' },
    });
    expect(cancelled.body.signature.signedAt).not.toBeNull();
    expect(again.status).toBe(200);
    expect(again.body.status).toBe('cancelled');
    expect(retry.status).toBe(409);
    expect(retry.body.code).toBe('invalid_state_transition');
    expect(application.body.status).toBe('withdrawn');
  });
});
