import { uuidv7 } from 'uuidv7';

import { type AuditChanges, type Principal } from '@shared/application';
import {
  EntityNotFoundError,
  FixedClock,
  InvalidStateTransitionError,
  Percentage,
} from '@shared/domain';

import { anIsa, NOW } from '../../../../test/factories/lending';
import {
  CLOSED_IBAN,
  FakeBankTransferProvider,
  FakeContractingDirectory,
  FakeESignatureProvider,
  InMemoryContractRepository,
  InMemoryDisbursementRepository,
  InMemoryFinancingPlanRepository,
  OPEN_IBAN,
} from '../../../../test/fakes/lending';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  ContractAccessDeniedError,
  type ContractProduct,
  EnvelopeNotRecordedError,
  LendingEvents,
  PayoffQuoteChangedError,
  renderContractDocument,
  SignatureMismatchError,
} from '../domain';

import {
  ActivateContractCommand,
  ActivateContractHandler,
} from './commands/activate-contract.command';
import {
  CheckDisbursementSettlementCommand,
  CheckDisbursementSettlementHandler,
} from './commands/check-disbursement-settlement.command';
import {
  CompleteContractCommand,
  CompleteContractHandler,
} from './commands/complete-contract.command';
import {
  type AcceptedOffer,
  DrawUpContractCommand,
  DrawUpContractHandler,
} from './commands/draw-up-contract.command';
import {
  ExecuteDisbursementCommand,
  ExecuteDisbursementHandler,
} from './commands/execute-disbursement.command';
import {
  OpenFinancingPlanCommand,
  OpenFinancingPlanHandler,
} from './commands/open-financing-plan.command';
import {
  ReconcileDisbursementCommand,
  ReconcileDisbursementHandler,
} from './commands/reconcile-disbursement.command';
import {
  RecordSignatureEventCommand,
  RecordSignatureEventHandler,
} from './commands/record-signature-event.command';
import {
  RequestDisbursementCommand,
  RequestDisbursementHandler,
} from './commands/request-disbursement.command';
import { RequestPayoffCommand, RequestPayoffHandler } from './commands/request-payoff.command';
import {
  RetryDisbursementCommand,
  RetryDisbursementHandler,
} from './commands/retry-disbursement.command';
import {
  documentHash,
  SendContractForSignatureCommand,
  SendContractForSignatureHandler,
} from './commands/send-contract-for-signature.command';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

function setup() {
  const clock = new FixedClock(NOW);
  const events = new RecordingEventBus();
  const uow = new InlineUnitOfWork();
  const contracts = new InMemoryContractRepository(events);
  const disbursements = new InMemoryDisbursementRepository(events);
  const plans = new InMemoryFinancingPlanRepository(events);
  const signatures = new FakeESignatureProvider();
  const bank = new FakeBankTransferProvider();
  const centerId = uuidv7();
  const programId = uuidv7();
  const catalog = new FakeContractingDirectory()
    .addCenter(centerId, { platformFeeBasisPoints: 500 })
    .addProgram(programId, centerId, 12);
  const studentId = uuidv7();
  const student: Principal = {
    kind: 'user',
    userId: studentId,
    roles: ['student'],
    centerId: null,
  };
  const offer = (
    product: ContractProduct = {
      kind: 'installments',
      termMonths: 12,
      annualRate: Percentage.fromPercent(9),
    },
  ): AcceptedOffer => ({
    applicationId: uuidv7(),
    studentId,
    centerId,
    programId,
    programName: 'Full Stack Bootcamp',
    principalCents: 6_000_00,
    product,
  });
  const execute = new ExecuteDisbursementHandler(uow, disbursements, catalog, bank, clock);
  const check = new CheckDisbursementSettlementHandler(uow, disbursements, bank, clock);
  const audited: AuditChanges[] = [];
  const audit = { describeChanges: (changes: AuditChanges) => audited.push(changes) };
  const handlers = {
    drawUp: new DrawUpContractHandler(uow, contracts, catalog, clock),
    send: new SendContractForSignatureHandler(uow, contracts, signatures, clock),
    signature: new RecordSignatureEventHandler(uow, contracts, audit, clock),
    requestDisbursement: new RequestDisbursementHandler(uow, contracts, disbursements, clock),
    execute,
    check,
    reconcile: new ReconcileDisbursementHandler(disbursements, execute, check),
    retry: new RetryDisbursementHandler(uow, disbursements, clock),
    activate: new ActivateContractHandler(uow, contracts, clock),
    openPlan: new OpenFinancingPlanHandler(uow, contracts, plans, clock),
    complete: new CompleteContractHandler(uow, contracts, clock),
    payoff: new RequestPayoffHandler(uow, contracts, plans, clock),
  };

  // The saga as the consumers and jobs run it.
  const sent = async (product?: ContractProduct): Promise<string> => {
    const contractId = await handlers.drawUp.execute(new DrawUpContractCommand(offer(product)));
    await handlers.send.execute(new SendContractForSignatureCommand(contractId));
    return contractId;
  };
  const signed = async (product?: ContractProduct): Promise<string> => {
    const contractId = await sent(product);
    const contract = await contracts.findById(contractId);
    await handlers.signature.execute(
      new RecordSignatureEventCommand({
        type: 'signed',
        envelopeId: contract?.signature?.envelopeId ?? '',
        documentHash: contract?.signature?.documentHash ?? '',
        occurredAt: NOW,
      }),
    );
    await handlers.requestDisbursement.execute(new RequestDisbursementCommand(contractId));
    return contractId;
  };
  const disbursementOf = async (contractId: string) => {
    const disbursement = await disbursements.findByContractId(contractId);
    if (!disbursement) throw new Error('no disbursement');
    return disbursement;
  };
  const active = async (product?: ContractProduct): Promise<string> => {
    const contractId = await signed(product);
    const disbursement = await disbursementOf(contractId);
    await handlers.execute.execute(new ExecuteDisbursementCommand(disbursement.id));
    await handlers.check.execute(new CheckDisbursementSettlementCommand(disbursement.id));
    await handlers.activate.execute(new ActivateContractCommand(contractId));
    await handlers.openPlan.execute(new OpenFinancingPlanCommand(contractId));
    return contractId;
  };

  return {
    clock,
    events,
    contracts,
    disbursements,
    plans,
    signatures,
    bank,
    catalog,
    audited,
    centerId,
    programId,
    student,
    offer,
    ...handlers,
    sent,
    signed,
    active,
    disbursementOf,
  };
}

describe('lending use cases', () => {
  describe('drawing up a contract', () => {
    it("should draw up an accepted offer with the center's fee and the program's length", async () => {
      const t = setup();
      const offer = t.offer();

      const contractId = await t.drawUp.execute(new DrawUpContractCommand(offer));

      const contract = await t.contracts.findById(contractId);
      expect(contract).toMatchObject({
        applicationId: offer.applicationId,
        studentId: offer.studentId,
        status: 'draft',
        program: { programId: t.programId, name: 'Full Stack Bootcamp', durationWeeks: 12 },
      });
      expect(contract?.terms.platformFee.basisPoints).toBe(500);
      expect(t.events.ofType(LendingEvents.ContractCreated)).toHaveLength(1);
    });

    it('should give back the same contract when the offer is delivered twice', async () => {
      const t = setup();
      const offer = t.offer();

      const first = await t.drawUp.execute(new DrawUpContractCommand(offer));
      const again = await t.drawUp.execute(new DrawUpContractCommand(offer));

      expect(again).toBe(first);
      expect(t.contracts.all()).toHaveLength(1);
    });

    it('should fail loudly when the catalog does not know the program', async () => {
      const t = setup();

      await expect(
        t.drawUp.execute(new DrawUpContractCommand({ ...t.offer(), programId: uuidv7() })),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('signature', () => {
    it('should send the document with its hash and keep the envelope', async () => {
      const t = setup();

      const contractId = await t.sent();

      const contract = await t.contracts.findById(contractId);
      const [envelope] = t.signatures.sent;
      expect(envelope?.document).toBe(renderContractDocument(contract!));
      expect(envelope?.documentHash).toBe(documentHash(envelope?.document ?? ''));
      expect(contract?.signature).toMatchObject({
        provider: 'fake',
        envelopeId: `fake-env-${contractId}`,
        documentHash: envelope?.documentHash,
      });
      expect(contract?.status).toBe('sent_for_signature');
    });

    it('should not send a contract twice', async () => {
      const t = setup();
      const contractId = await t.sent();

      await t.send.execute(new SendContractForSignatureCommand(contractId));

      expect(t.signatures.sent).toHaveLength(1);
    });

    it('should leave the contract a draft when the provider is down, for the job to retry', async () => {
      const t = setup();
      const contractId = await t.drawUp.execute(new DrawUpContractCommand(t.offer()));
      t.signatures.failWith = new Error('provider down');

      await expect(t.send.execute(new SendContractForSignatureCommand(contractId))).rejects.toThrow(
        'provider down',
      );
      expect((await t.contracts.findById(contractId))?.status).toBe('draft');
    });

    it('should be signed by the callback, and request one disbursement for the center', async () => {
      const t = setup();

      const contractId = await t.signed();
      await t.requestDisbursement.execute(new RequestDisbursementCommand(contractId));

      expect((await t.contracts.findById(contractId))?.status).toBe('signed');
      expect(t.disbursements.all()).toHaveLength(1);
      // 6,000 less the 5 % fee.
      expect((await t.disbursementOf(contractId)).amount.cents).toBe(5_700_00);
      expect(t.audited).toEqual([{ status: { before: 'sent_for_signature', after: 'signed' } }]);
    });

    it('should neither write nor audit a repeated callback', async () => {
      const t = setup();
      const contractId = await t.signed();
      const contract = await t.contracts.findById(contractId);
      const version = contract?.version;

      const result = await t.signature.execute(
        new RecordSignatureEventCommand({
          type: 'signed',
          envelopeId: contract?.signature?.envelopeId ?? '',
          documentHash: contract?.signature?.documentHash ?? '',
          occurredAt: NOW,
        }),
      );

      expect(result).toEqual({ id: contractId, status: 'signed' });
      expect((await t.contracts.findById(contractId))?.version).toBe(version);
      expect(t.audited).toHaveLength(1);
    });

    it('should refuse a callback over another document', async () => {
      const t = setup();
      const contractId = await t.sent();

      await expect(
        t.signature.execute(
          new RecordSignatureEventCommand({
            type: 'signed',
            envelopeId: `fake-env-${contractId}`,
            documentHash: 'f'.repeat(64),
            occurredAt: NOW,
          }),
        ),
      ).rejects.toThrow(SignatureMismatchError);
    });

    it.each([
      ['declined', 'signature_declined'],
      ['expired', 'signature_expired'],
    ] as const)('should cancel the contract when the envelope is %s', async (type, reason) => {
      const t = setup();
      const contractId = await t.sent();

      await t.signature.execute(
        new RecordSignatureEventCommand({
          type,
          envelopeId: `fake-env-${contractId}`,
          occurredAt: NOW,
        }),
      );

      expect(await t.contracts.findById(contractId)).toMatchObject({
        status: 'cancelled',
        cancellationReason: reason,
      });
    });

    it('should report a callback for an unknown envelope as not found', async () => {
      const t = setup();

      await expect(
        t.signature.execute(
          new RecordSignatureEventCommand({
            type: 'declined',
            envelopeId: 'env-x',
            occurredAt: NOW,
          }),
        ),
      ).rejects.toThrow(EnvelopeNotRecordedError);
    });

    it('should not disburse a contract that is not signed', async () => {
      const t = setup();
      const contractId = await t.sent();

      await expect(
        t.requestDisbursement.execute(new RequestDisbursementCommand(contractId)),
      ).rejects.toThrow(InvalidStateTransitionError);
    });
  });

  describe('disbursement', () => {
    it('should pay the center, activate the contract and open its plan, once', async () => {
      const t = setup();

      const contractId = await t.active();
      const disbursement = await t.disbursementOf(contractId);
      await t.execute.execute(new ExecuteDisbursementCommand(disbursement.id));
      await t.activate.execute(new ActivateContractCommand(contractId));
      await t.openPlan.execute(new OpenFinancingPlanCommand(contractId));

      const [transfer] = [...t.bank.transfers.values()];
      expect(t.bank.transfers.size).toBe(1);
      expect(transfer).toMatchObject({
        idempotencyKey: `${disbursement.id}.1`,
        creditorIban: OPEN_IBAN,
      });
      expect(transfer?.amount.cents).toBe(5_700_00);
      expect(await t.disbursementOf(contractId)).toMatchObject({ status: 'settled' });
      expect(await t.contracts.findById(contractId)).toMatchObject({ status: 'active' });
      expect((await t.contracts.findById(contractId))?.activatedOn?.toString()).toBe('2026-10-12');
      expect(t.plans.all()).toHaveLength(1);
      expect(t.events.ofType(LendingEvents.DisbursementSettled)).toHaveLength(1);
      expect(t.events.ofType(LendingEvents.ContractActivated)).toHaveLength(1);
    });

    it('should wait while the bank has not settled the transfer', async () => {
      const t = setup();
      t.bank.settleImmediately = false;
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);
      await t.execute.execute(new ExecuteDisbursementCommand(id));

      expect(await t.check.execute(new CheckDisbursementSettlementCommand(id))).toBe('pending');
      expect((await t.disbursementOf(contractId)).status).toBe('sent');
    });

    it('should fail on a closed account, and pay the corrected account when ops retry', async () => {
      const t = setup();
      t.catalog.addCenter(t.centerId, { iban: CLOSED_IBAN });
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);

      await t.execute.execute(new ExecuteDisbursementCommand(id));
      expect(await t.check.execute(new CheckDisbursementSettlementCommand(id))).toBe('failed');
      expect(await t.disbursementOf(contractId)).toMatchObject({
        status: 'failed',
        failureReason: 'account_closed',
      });

      t.catalog.addCenter(t.centerId, { iban: OPEN_IBAN });
      const retried = await t.retry.execute(new RetryDisbursementCommand(OPS, id));
      await t.execute.execute(new ExecuteDisbursementCommand(id));
      await t.check.execute(new CheckDisbursementSettlementCommand(id));

      expect(retried).toMatchObject({ status: 'pending', attempt: 2 });
      expect(t.bank.transfers.get(`${id}.2`)?.creditorIban).toBe(OPEN_IBAN);
      expect((await t.disbursementOf(contractId)).status).toBe('settled');
      expect(t.events.ofType(LendingEvents.DisbursementRetried)).toHaveLength(1);
    });

    it('should hold the money of a center that is not active, or has no payout account', async () => {
      const t = setup();
      t.catalog.addCenter(t.centerId, { active: false });
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);

      await t.execute.execute(new ExecuteDisbursementCommand(id));

      expect(t.bank.transfers.size).toBe(0);
      expect(await t.disbursementOf(contractId)).toMatchObject({
        status: 'failed',
        failureReason: 'center_not_active',
      });

      t.catalog.centers.delete(t.centerId);
      await t.retry.execute(new RetryDisbursementCommand(OPS, id));
      await t.execute.execute(new ExecuteDisbursementCommand(id));
      expect((await t.disbursementOf(contractId)).failureReason).toBe('no_payout_account');
    });

    it('should leave the disbursement pending when the bank is down, for the job to retry', async () => {
      const t = setup();
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);
      t.bank.failWith = new Error('bank down');

      await expect(t.execute.execute(new ExecuteDisbursementCommand(id))).rejects.toThrow(
        'bank down',
      );
      expect((await t.disbursementOf(contractId)).status).toBe('pending');
    });

    // The bank took the transfer but the answer was lost; meanwhile the center was suspended and
    // changed its IBAN. The repeated run must not fail the attempt (an ops retry would then pay a
    // second time) nor pay another account: it sends the same key to the account it started with.
    it('should send a started attempt again to the same account, whatever changed since', async () => {
      const t = setup();
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);
      const transfer = t.bank.transfer.bind(t.bank);
      t.bank.transfer = async (request) => {
        await transfer(request);
        throw new Error('timeout reading the answer');
      };
      await expect(t.execute.execute(new ExecuteDisbursementCommand(id))).rejects.toThrow(
        'timeout',
      );
      t.bank.transfer = transfer;
      t.catalog.addCenter(t.centerId, { active: false, iban: CLOSED_IBAN });

      await t.execute.execute(new ExecuteDisbursementCommand(id));

      expect(t.bank.transfers.size).toBe(1);
      expect(t.bank.transfers.get(`${id}.1`)?.creditorIban).toBe(OPEN_IBAN);
      expect((await t.disbursementOf(contractId)).status).toBe('sent');
    });

    it('should have nothing to check for a disbursement not sent', async () => {
      const t = setup();
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);

      expect(await t.check.execute(new CheckDisbursementSettlementCommand(id))).toBe(
        'nothing_to_check',
      );
    });

    it('should let ops reconcile a disbursement whose jobs ran out, without paying twice', async () => {
      const t = setup();
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);
      t.bank.failWith = new Error('bank down');
      await expect(t.execute.execute(new ExecuteDisbursementCommand(id))).rejects.toThrow();
      t.bank.failWith = null;
      t.bank.settleImmediately = false;

      const sent = await t.reconcile.execute(new ReconcileDisbursementCommand(OPS, id));
      t.bank.settleImmediately = true;
      const settled = await t.reconcile.execute(new ReconcileDisbursementCommand(OPS, id));

      expect(sent.status).toBe('sent');
      expect(settled.status).toBe('settled');
      expect(t.bank.transfers.size).toBe(1);
      await expect(
        t.reconcile.execute(new ReconcileDisbursementCommand(t.student, id)),
      ).rejects.toThrow(ContractAccessDeniedError);
    });

    it('should let only staff retry a disbursement', async () => {
      const t = setup();
      const contractId = await t.signed();
      const { id } = await t.disbursementOf(contractId);

      await expect(t.retry.execute(new RetryDisbursementCommand(t.student, id))).rejects.toThrow(
        ContractAccessDeniedError,
      );
      await expect(t.retry.execute(new RetryDisbursementCommand(OPS, uuidv7()))).rejects.toThrow(
        EntityNotFoundError,
      );
      await expect(t.retry.execute(new RetryDisbursementCommand(OPS, id))).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe('plan', () => {
    it('should open the ISA terms of an ISA contract', async () => {
      const t = setup();

      const contractId = await t.active(anIsa());

      const plan = await t.plans.findByContractId(contractId);
      expect(plan?.terms.kind).toBe('isa');
    });

    it('should not open a plan before the contract is active', async () => {
      const t = setup();
      const contractId = await t.signed();

      await expect(t.openPlan.execute(new OpenFinancingPlanCommand(contractId))).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });

    it('should complete an active contract once, when its plan ends', async () => {
      const t = setup();
      const contractId = await t.active();

      await t.complete.execute(new CompleteContractCommand(contractId));
      await t.complete.execute(new CompleteContractCommand(contractId));

      expect((await t.contracts.findById(contractId))?.status).toBe('completed');
      expect(t.events.ofType(LendingEvents.ContractCompleted)).toHaveLength(1);
    });
  });

  describe('payoff', () => {
    // 6,000 at 9 % over 12 months, activated today: nothing due, nothing accrued yet.
    it('should record the payoff the student was quoted', async () => {
      const t = setup();
      const contractId = await t.active();

      const quote = await t.payoff.execute(
        new RequestPayoffCommand(t.student, contractId, 6_000_00),
      );

      expect(quote.totalCents).toBe(6_000_00);
      expect(t.events.ofType(LendingEvents.PayoffRequested)).toHaveLength(1);
    });

    it('should refuse a payoff whose amount moved since the quote', async () => {
      const t = setup();
      const contractId = await t.active();
      t.clock.set(new Date('2026-10-27T10:00:00Z'));

      await expect(
        t.payoff.execute(new RequestPayoffCommand(t.student, contractId, 6_000_00)),
      ).rejects.toThrow(PayoffQuoteChangedError);
    });

    it('should let only the student pay off, and hide the contract from other students', async () => {
      const t = setup();
      const contractId = await t.active();
      const center: Principal = {
        kind: 'user',
        userId: uuidv7(),
        roles: ['center_admin'],
        centerId: t.centerId,
      };
      const stranger: Principal = { ...t.student, userId: uuidv7() };

      await expect(
        t.payoff.execute(new RequestPayoffCommand(center, contractId, 6_000_00)),
      ).rejects.toThrow(ContractAccessDeniedError);
      await expect(
        t.payoff.execute(new RequestPayoffCommand(stranger, contractId, 6_000_00)),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
