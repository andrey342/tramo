import { uuidv7 } from 'uuidv7';

import { type AuditChanges, type Principal } from '@shared/application';
import {
  EntityNotFoundError,
  FixedClock,
  InvalidStateTransitionError,
  InvalidValueError,
} from '@shared/domain';

import { aCharge, aMandate, day, NOW, STUDENT_IBAN } from '../../../../test/factories/billing';
import {
  FakePaymentGateway,
  FakeRepaymentPlans,
  InMemoryBillingQueries,
  InMemoryChargeRepository,
  InMemoryDeclarationReminders,
  InMemoryIncomeDeclarationRepository,
  InMemoryPaymentMandateRepository,
} from '../../../../test/fakes/billing';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  BillingAccessDeniedError,
  BillingEvents,
  type Charge,
  ContractNotRepayingError,
  IncomeAlreadyDeclaredError,
  MandateMissingError,
  NotAnIncomeShareError,
  PaymentMismatchError,
  UnknownCollectionAttemptError,
} from '../domain';

import {
  CancelScheduledChargesCommand,
  CancelScheduledChargesHandler,
} from './commands/cancel-scheduled-charges.command';
import {
  CollectDueChargesCommand,
  CollectDueChargesHandler,
} from './commands/collect-due-charges.command';
import {
  CreatePayoffChargeCommand,
  CreatePayoffChargeHandler,
} from './commands/create-payoff-charge.command';
import { DeclareIncomeCommand, DeclareIncomeHandler } from './commands/declare-income.command';
import {
  ExecuteChargeCollectionCommand,
  ExecuteChargeCollectionHandler,
} from './commands/execute-charge-collection.command';
import {
  RecordPaymentResultCommand,
  RecordPaymentResultHandler,
} from './commands/record-payment-result.command';
import { RetryChargeCommand, RetryChargeHandler } from './commands/retry-charge.command';
import {
  RunBillingCycleCommand,
  RunBillingCycleHandler,
} from './commands/run-billing-cycle.command';
import { RunDunningCommand, RunDunningHandler } from './commands/run-dunning.command';
import {
  SendDeclarationRemindersCommand,
  SendDeclarationRemindersHandler,
} from './commands/send-declaration-reminders.command';
import { SignMandateCommand, SignMandateHandler } from './commands/sign-mandate.command';
import { GetStatementHandler, GetStatementQuery } from './queries/get-statement.query';
import { ListChargesHandler, ListChargesQuery } from './queries/list-charges.query';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

function setup() {
  const clock = new FixedClock(NOW);
  const events = new RecordingEventBus();
  const uow = new InlineUnitOfWork();
  const charges = new InMemoryChargeRepository(events);
  const mandates = new InMemoryPaymentMandateRepository(events);
  const declarations = new InMemoryIncomeDeclarationRepository(events);
  const queries = new InMemoryBillingQueries(charges);
  const reminders = new InMemoryDeclarationReminders();
  const gateway = new FakePaymentGateway();
  const plans = new FakeRepaymentPlans();
  const audited: AuditChanges[] = [];
  const audit = { describeChanges: (changes: AuditChanges) => audited.push(changes) };
  const studentId = uuidv7();
  const centerId = uuidv7();
  const student: Principal = {
    kind: 'user',
    userId: studentId,
    roles: ['student'],
    centerId: null,
  };
  const contract = (product: 'installments' | 'isa' = 'installments', status = 'active') => {
    const id = uuidv7();
    plans.addContract({ id, studentId, centerId, product, status });
    return id;
  };
  const charge = async (overrides: Parameters<typeof aCharge>[0] = {}): Promise<Charge> => {
    const created = aCharge({ studentId, centerId, ...overrides });
    await charges.save(created);
    events.published.length = 0;
    return created;
  };
  const mandate = async (contractId: string) => {
    const signed = aMandate({ contractId, studentId });
    await mandates.save(signed);
    return signed;
  };
  return {
    clock,
    events,
    charges,
    mandates,
    declarations,
    queries,
    reminders,
    gateway,
    plans,
    audited,
    student,
    studentId,
    centerId,
    contract,
    charge,
    mandate,
    sign: new SignMandateHandler(uow, mandates, plans, clock),
    declare: new DeclareIncomeHandler(uow, declarations, plans, clock),
    cycle: new RunBillingCycleHandler(uow, plans, charges, declarations, clock),
    collect: new CollectDueChargesHandler(uow, charges, mandates, clock),
    execute: new ExecuteChargeCollectionHandler(uow, charges, mandates, gateway),
    result: new RecordPaymentResultHandler(uow, charges, audit, clock),
    dunning: new RunDunningHandler(uow, charges, mandates, clock),
    retry: new RetryChargeHandler(uow, charges, mandates, clock),
    payoff: new CreatePayoffChargeHandler(uow, charges, mandates, plans, clock),
    cancel: new CancelScheduledChargesHandler(uow, charges, clock),
    remind: new SendDeclarationRemindersHandler(uow, plans, declarations, reminders, events, clock),
    list: new ListChargesHandler(plans, queries),
    statement: new GetStatementHandler(plans, queries),
  };
}

describe('billing use cases', () => {
  describe('mandates', () => {
    it('should let the student sign one, replacing the one in force', async () => {
      const t = setup();
      const contractId = t.contract();

      const first = await t.sign.execute(
        new SignMandateCommand(t.student, contractId, STUDENT_IBAN),
      );
      const second = await t.sign.execute(
        new SignMandateCommand(t.student, contractId, 'ES9121000418450200051332'),
      );

      expect(second).toMatchObject({
        status: 'active',
        ibanMasked: expect.stringMatching(/1332$/),
      });
      expect((await t.mandates.findById(first.id))?.status).toBe('revoked');
      expect((await t.mandates.findActiveByContract(contractId))?.id).toBe(second.id);
    });

    it('should refuse a mandate for someone else, by staff, on a contract not repaid, or a bad IBAN', async () => {
      const t = setup();
      const contractId = t.contract();
      const stranger: Principal = { ...t.student, userId: uuidv7() };

      await expect(
        t.sign.execute(new SignMandateCommand(stranger, contractId, STUDENT_IBAN)),
      ).rejects.toThrow(EntityNotFoundError);
      await expect(
        t.sign.execute(new SignMandateCommand(OPS, contractId, STUDENT_IBAN)),
      ).rejects.toThrow(BillingAccessDeniedError);
      await expect(
        t.sign.execute(
          new SignMandateCommand(t.student, t.contract('installments', 'completed'), STUDENT_IBAN),
        ),
      ).rejects.toThrow(ContractNotRepayingError);
      await expect(
        t.sign.execute(new SignMandateCommand(t.student, contractId, 'ES0000000000000000000000')),
      ).rejects.toThrow(InvalidValueError);
    });
  });

  describe('income declarations', () => {
    it('should take one declaration per month of an ISA', async () => {
      const t = setup();
      const contractId = t.contract('isa');

      const declared = await t.declare.execute(
        new DeclareIncomeCommand(t.student, contractId, '2026-10', 2_000_00),
      );

      expect(declared).toMatchObject({ period: '2026-10', grossMonthlyIncomeCents: 2_000_00 });
      await expect(
        t.declare.execute(new DeclareIncomeCommand(t.student, contractId, '2026-10', 1_000_00)),
      ).rejects.toThrow(IncomeAlreadyDeclaredError);
      await expect(
        t.declare.execute(new DeclareIncomeCommand(t.student, t.contract(), '2026-10', 1_000_00)),
      ).rejects.toThrow(NotAnIncomeShareError);
    });
  });

  describe('billing cycle', () => {
    // Instalments 2 to 4 fall due on the 12th of December, January and February.
    const withInstallments = (t: ReturnType<typeof setup>) => {
      const contractId = uuidv7();
      t.plans.addContract(
        {
          id: contractId,
          studentId: t.studentId,
          centerId: t.centerId,
          product: 'installments',
          status: 'active',
        },
        {
          kind: 'installments',
          unpaidInstallments: [
            { number: 2, dueDate: '2026-12-12', totalCents: 337_50 },
            { number: 3, dueDate: '2027-01-12', totalCents: 337_50 },
            { number: 4, dueDate: '2027-02-12', totalCents: 337_52 },
          ],
          nextIsaPeriod: null,
        },
      );
      return contractId;
    };

    it('should charge the instalments falling due by the end of the month, once', async () => {
      const t = setup();
      const contractId = withInstallments(t);

      const december = await t.cycle.execute(new RunBillingCycleCommand(day('2026-12-01')));
      const again = await t.cycle.execute(new RunBillingCycleCommand(day('2026-12-01')));
      const february = await t.cycle.execute(new RunBillingCycleCommand(day('2027-02-01')));

      expect(december).toEqual({ plansBilled: 1, chargesCreated: 1, failedContractIds: [] });
      expect(again.chargesCreated).toBe(0);
      expect(february.chargesCreated).toBe(2);
      const fourth = await t.charges.findByReference(contractId, 'installment:4');
      expect(fourth).toMatchObject({
        kind: 'installment',
        installmentNumber: 4,
        period: '2027-02',
      });
      expect(fourth?.amount.cents).toBe(337_52);
      expect(fourth?.dueDate.toString()).toBe('2027-02-12');
    });

    // Income of July (2,000) and August (none) are assessed in September.
    it('should assess every ended month of an ISA on what was declared, and charge the share', async () => {
      const t = setup();
      const contractId = uuidv7();
      t.plans.addContract(
        {
          id: contractId,
          studentId: t.studentId,
          centerId: t.centerId,
          product: 'isa',
          status: 'active',
        },
        { kind: 'isa', unpaidInstallments: [], nextIsaPeriod: '2026-07' },
      );
      await t.declare.execute(new DeclareIncomeCommand(t.student, contractId, '2026-07', 2_000_00));

      const result = await t.cycle.execute(new RunBillingCycleCommand(day('2026-09-01')));

      expect(result.chargesCreated).toBe(1);
      expect(t.plans.assessed).toEqual([
        { contractId, period: '2026-07', incomeCents: 2_000_00 },
        { contractId, period: '2026-08', incomeCents: null },
      ]);
      const july = await t.charges.findByReference(contractId, 'isa:2026-07');
      expect(july?.amount.cents).toBe(200_00);
      expect(july?.dueDate.toString()).toBe('2026-08-05');
    });

    it('should go on with the other plans when one fails, and report it', async () => {
      const t = setup();
      const healthy = withInstallments(t);
      const broken = withInstallments(t);
      const save = t.charges.save.bind(t.charges);
      t.charges.save = (charge) =>
        charge.contractId === broken ? Promise.reject(new Error('db down')) : save(charge);

      const result = await t.cycle.execute(new RunBillingCycleCommand(day('2026-12-01')));

      expect(result).toMatchObject({
        plansBilled: 1,
        chargesCreated: 1,
        failedContractIds: [broken],
      });
      expect(await t.charges.findByReference(healthy, 'installment:2')).not.toBeNull();
    });
  });

  describe('collection', () => {
    it('should start collecting the charges due under a mandate, and leave the others', async () => {
      const t = setup();
      const withMandate = t.contract();
      await t.mandate(withMandate);
      const due = await t.charge({ contractId: withMandate });
      const later = await t.charge({
        contractId: withMandate,
        dueDate: '2026-12-12',
        reference: 'installment:2',
      });
      const noMandate = await t.charge({ contractId: t.contract() });

      expect(await t.collect.execute(new CollectDueChargesCommand(day('2026-11-12')))).toBe(1);
      expect((await t.charges.findById(due.id))?.status).toBe('pending');
      expect((await t.charges.findById(later.id))?.status).toBe('scheduled');
      expect((await t.charges.findById(noMandate.id))?.status).toBe('scheduled');
      expect(t.events.ofType(BillingEvents.ChargeSubmitted)).toHaveLength(1);
    });

    it('should ask the provider once per attempt, with the mandate it started under', async () => {
      const t = setup();
      const contractId = t.contract();
      const original = await t.mandate(contractId);
      const charge = await t.charge({ contractId });
      await t.collect.execute(new CollectDueChargesCommand(day('2026-11-12')));
      await t.sign.execute(
        new SignMandateCommand(t.student, contractId, 'ES9121000418450200051332'),
      );
      const key = `${charge.id}.1`;

      await t.execute.execute(new ExecuteChargeCollectionCommand(charge.id, key));
      await t.execute.execute(new ExecuteChargeCollectionCommand(charge.id, key));

      expect(t.gateway.requests.size).toBe(1);
      expect(t.gateway.requests.get(key)).toMatchObject({
        mandateReference: original.reference,
        debtorIban: STUDENT_IBAN,
      });
      expect((await t.charges.findById(charge.id))?.currentAttempt?.paymentId).toBe('fake-pay-1');
    });

    it('should record what the provider answers, once, in the audit trail', async () => {
      const t = setup();
      const contractId = t.contract();
      await t.mandate(contractId);
      const paid = await t.charge({ contractId });
      const refused = await t.charge({
        contractId,
        reference: 'installment:2',
        installmentNumber: 2,
      });
      await t.collect.execute(new CollectDueChargesCommand(day('2026-11-12')));

      const ok = await t.result.execute(
        new RecordPaymentResultCommand({
          reference: `${paid.id}.1`,
          paymentId: 'pay-1',
          outcome: 'succeeded',
          failureReason: null,
        }),
      );
      await t.result.execute(
        new RecordPaymentResultCommand({
          reference: `${paid.id}.1`,
          paymentId: 'pay-1',
          outcome: 'succeeded',
          failureReason: null,
        }),
      );
      const ko = await t.result.execute(
        new RecordPaymentResultCommand({
          reference: `${refused.id}.1`,
          paymentId: 'pay-2',
          outcome: 'failed',
          failureReason: 'insufficient_funds',
        }),
      );

      expect(ok).toEqual({ id: paid.id, status: 'paid' });
      expect(ko).toEqual({ id: refused.id, status: 'failed' });
      expect(t.events.ofType(BillingEvents.ChargePaid)).toHaveLength(1);
      expect(t.audited).toEqual([
        { status: { before: 'pending', after: 'paid' } },
        { status: { before: 'pending', after: 'failed' } },
      ]);
      await expect(
        t.result.execute(
          new RecordPaymentResultCommand({
            reference: `${uuidv7()}.1`,
            paymentId: 'pay-3',
            outcome: 'succeeded',
            failureReason: null,
          }),
        ),
      ).rejects.toThrow(UnknownCollectionAttemptError);
      // A callback naming another payment for the attempt is not the one the provider accepted.
      await expect(
        t.result.execute(
          new RecordPaymentResultCommand({
            reference: `${refused.id}.1`,
            paymentId: 'pay-forged',
            outcome: 'succeeded',
            failureReason: null,
          }),
        ),
      ).rejects.toThrow(PaymentMismatchError);
    });

    it('should let only staff retry a charge, under the mandate in force', async () => {
      const t = setup();
      const contractId = t.contract();
      const charge = await t.charge({ contractId });

      await expect(t.retry.execute(new RetryChargeCommand(t.student, charge.id))).rejects.toThrow(
        BillingAccessDeniedError,
      );
      await expect(t.retry.execute(new RetryChargeCommand(OPS, charge.id))).rejects.toThrow(
        MandateMissingError,
      );
      await t.mandate(contractId);
      expect((await t.retry.execute(new RetryChargeCommand(OPS, charge.id))).status).toBe(
        'pending',
      );
      await expect(t.retry.execute(new RetryChargeCommand(OPS, charge.id))).rejects.toThrow(
        InvalidStateTransitionError,
      );
    });
  });

  describe('dunning', () => {
    it('should give notice the day after the due date and retry three days after it', async () => {
      const t = setup();
      const contractId = t.contract();
      const charge = await t.charge({ contractId });

      const notice = await t.dunning.execute(new RunDunningCommand(day('2026-11-13')));
      await t.mandate(contractId);
      const retry = await t.dunning.execute(new RunDunningCommand(day('2026-11-15')));

      expect(notice).toEqual({ chargesReviewed: 1, retries: 0 });
      expect(retry).toEqual({ chargesReviewed: 1, retries: 1 });
      expect((await t.charges.findById(charge.id))?.status).toBe('pending');
      expect(t.events.ofType(BillingEvents.ChargeOverdue)).toHaveLength(1);
    });

    it('should put the contract in arrears at 30 days and write the charge off at 90', async () => {
      const t = setup();
      const charge = await t.charge({ contractId: t.contract() });

      await t.dunning.execute(new RunDunningCommand(day('2026-12-12')));
      await t.dunning.execute(new RunDunningCommand(day('2027-02-10')));
      const after = await t.dunning.execute(new RunDunningCommand(day('2027-03-01')));

      expect(t.events.ofType(BillingEvents.ContractInArrears)).toHaveLength(1);
      expect(t.events.ofType(BillingEvents.ChargeWrittenOff)).toHaveLength(1);
      expect((await t.charges.findById(charge.id))?.status).toBe('written_off');
      expect(after.chargesReviewed).toBe(0);
    });
  });

  describe('end of a plan', () => {
    it('should charge a payoff once, collecting it at once under the mandate', async () => {
      const t = setup();
      const contractId = t.contract();
      await t.mandate(contractId);
      const payoff = {
        planId: uuidv7(),
        contractId,
        amountCents: 6_000_00,
        asOf: day('2026-11-20'),
      };

      await t.payoff.execute(new CreatePayoffChargeCommand(payoff));
      await t.payoff.execute(new CreatePayoffChargeCommand(payoff));

      const charge = await t.charges.findByReference(contractId, `payoff:${payoff.planId}`);
      expect(charge).toMatchObject({ kind: 'payoff', status: 'pending', period: '2026-11' });
      expect(t.charges.all()).toHaveLength(1);
    });

    it('should cancel the charges not yet in collection', async () => {
      const t = setup();
      const contractId = t.contract();
      await t.mandate(contractId);
      const collecting = await t.charge({ contractId });
      await t.collect.execute(new CollectDueChargesCommand(day('2026-11-12')));
      const later = await t.charge({
        contractId,
        reference: 'installment:2',
        dueDate: '2026-11-30',
      });

      expect(await t.cancel.execute(new CancelScheduledChargesCommand(contractId))).toBe(1);
      expect((await t.charges.findById(later.id))?.status).toBe('cancelled');
      expect((await t.charges.findById(collecting.id))?.status).toBe('pending');
    });
  });

  describe('declaration reminders', () => {
    it('should remind once a month the ISA students who have not declared', async () => {
      const t = setup();
      const [silent, declared, notStarted] = [uuidv7(), uuidv7(), uuidv7()];
      for (const [id, next] of [
        [silent, '2026-07'],
        [declared, '2026-07'],
        [notStarted, '2027-03'],
      ] as const) {
        t.plans.addContract(
          { id, studentId: t.studentId, centerId: t.centerId, product: 'isa', status: 'active' },
          { kind: 'isa', unpaidInstallments: [], nextIsaPeriod: next },
        );
      }
      await t.declare.execute(new DeclareIncomeCommand(t.student, declared, '2026-11', 2_000_00));

      const sent = await t.remind.execute(new SendDeclarationRemindersCommand(day('2026-11-25')));
      const again = await t.remind.execute(new SendDeclarationRemindersCommand(day('2026-11-25')));

      expect(sent).toBe(1);
      expect(again).toBe(0);
      expect(t.events.ofType(BillingEvents.IncomeDeclarationDue)).toEqual([
        expect.objectContaining({
          payload: { contractId: silent, studentId: t.studentId, period: '2026-11' },
        }),
      ]);
    });
  });

  describe('reading', () => {
    it('should show the student and staff the charges and a statement with its balance', async () => {
      const t = setup();
      const contractId = t.contract();
      const charge = await t.charge({ contractId });
      t.queries.entries.push(
        {
          contractId,
          occurredAt: NOW,
          type: 'charge',
          chargeId: charge.id,
          description: 'Instalment 1',
          amountCents: 337_50,
        },
        {
          contractId,
          occurredAt: NOW,
          type: 'payment',
          chargeId: charge.id,
          description: 'Payment',
          amountCents: -337_50,
        },
        {
          contractId,
          occurredAt: NOW,
          type: 'charge',
          chargeId: uuidv7(),
          description: 'Instalment 2',
          amountCents: 337_50,
        },
      );

      const page = await t.list.execute(new ListChargesQuery(t.student, contractId, { limit: 10 }));
      const statement = await t.statement.execute(new GetStatementQuery(OPS, contractId));

      expect(page.data.map((item) => item.id)).toEqual([charge.id]);
      expect(statement.entries.map((entry) => entry.balanceCents)).toEqual([337_50, 0, 337_50]);
      expect(statement.balanceCents).toBe(337_50);
      await expect(
        t.list.execute(
          new ListChargesQuery({ ...t.student, userId: uuidv7() }, contractId, { limit: 10 }),
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });
});
