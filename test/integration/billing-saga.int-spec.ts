import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { ExecuteChargeCollectionCommand } from '@modules/billing/application/commands/execute-charge-collection.command';
import {
  RunBillingNowCommand,
  RunDunningNowCommand,
} from '@modules/billing/application/commands/ops-runs.command';
import { RecordPaymentResultCommand } from '@modules/billing/application/commands/record-payment-result.command';
import { SignMandateCommand } from '@modules/billing/application/commands/sign-mandate.command';
import { GetStatementQuery } from '@modules/billing/application/queries/get-statement.query';
import { BillingModule } from '@modules/billing/billing.module';
import {
  type Charge,
  CHARGE_REPOSITORY,
  type ChargeRepository,
  INCOME_DECLARATION_REPOSITORY,
  type IncomeDeclarationRepository,
} from '@modules/billing/domain';
import { RequestPayoffCommand } from '@modules/lending/application/commands/request-payoff.command';
import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '@modules/lending/domain';
import { LendingModule } from '@modules/lending/lending.module';
import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CalendarDate } from '@shared/domain';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';

import { aDeclaration, STUDENT_IBAN } from '../factories/billing';
import { anActiveContract, anIsa, aPlan } from '../factories/lending';
import { eventually } from '../helpers/eventually';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

// Crosses two modules (billing collects, lending keeps the plan and the contract), so it lives
// outside both. The outbox is published by hand; the provider's answers are recorded directly.
describe('billing saga (integration)', () => {
  let app: INestApplicationContext;
  let commands: CommandBus;
  let charges: ChargeRepository;
  let contracts: ContractRepository;
  let plans: FinancingPlanRepository;
  let publisher: OutboxPublisher;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        LendingModule,
        BillingModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    commands = app.get(CommandBus);
    charges = app.get(CHARGE_REPOSITORY);
    contracts = app.get(CONTRACT_REPOSITORY);
    plans = app.get(FINANCING_PLAN_REPOSITORY);
    publisher = app.get(OutboxPublisher);
    await app
      .get(DataSource)
      .query('UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL');
  });

  afterAll(async () => {
    await app.close();
  });

  // An active contract of 24 instalments of 337.50, activated today; its student.
  async function repaying(withMandate: boolean) {
    const today = CalendarDate.fromInstant(new Date());
    const contract = anActiveContract();
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await contracts.save(contract);
      await plans.save(aPlan({ contractId: contract.id, activatedOn: today.toString() }));
    });
    const student: Principal = {
      kind: 'user',
      userId: contract.studentId,
      roles: ['student'],
      centerId: null,
    };
    if (withMandate) {
      await commands.execute(new SignMandateCommand(student, contract.id, STUDENT_IBAN));
    }
    const firstDue = today.addMonths(1).withDay(Math.min(today.day, 28));
    return { contractId: contract.id, student, today, firstDue };
  }

  async function until<T>(read: () => Promise<T>, check: (value: T) => void): Promise<T> {
    let last: T | undefined;
    await eventually(
      async () => {
        await publisher.publishBatch();
        last = await read();
        check(last);
      },
      { timeoutMs: 30_000 },
    );
    return last as T;
  }

  async function collect(charge: Charge | null, outcome: 'succeeded' | 'failed'): Promise<void> {
    const key = charge?.currentAttempt?.key ?? '';
    await commands.execute(new ExecuteChargeCollectionCommand(charge?.id ?? '', key));
    const accepted = await charges.findById(charge?.id ?? '');
    await commands.execute(
      new RecordPaymentResultCommand({
        reference: key,
        paymentId: accepted?.currentAttempt?.paymentId ?? '',
        outcome,
        failureReason: null,
      }),
    );
  }

  it('should bill and collect an instalment, mark it paid in the plan and on the statement', async () => {
    const { contractId, firstDue } = await repaying(true);

    const run = await commands.execute(new RunBillingNowCommand(OPS, firstDue, contractId));
    const charge = await charges.findByReference(contractId, 'installment:1');
    await collect(charge, 'succeeded');

    expect(run).toMatchObject({ plansBilled: 1, chargesCreated: 1, collectionsSubmitted: 1 });
    expect(charge?.attempts).toHaveLength(1);
    const plan = await until(
      () => plans.findByContractId(contractId),
      (found) => {
        expect(found?.terms.kind === 'installments' && found.terms.paidInstallments).toEqual([1]);
      },
    );
    expect(plan?.status).toBe('active');
    const statement = await until(
      () => app.get(QueryBus).execute(new GetStatementQuery(OPS, contractId)),
      (found) => {
        expect(found.entries).toHaveLength(2);
      },
    );
    expect(statement.balanceCents).toBe(0);
  }, 60_000);

  // ADR 020: the bank sends a collected debit back; a repeated notice of it writes nothing.
  it('should owe an instalment again, on the plan and the statement, when the bank returns it', async () => {
    const { contractId, firstDue } = await repaying(true);
    await commands.execute(new RunBillingNowCommand(OPS, firstDue, contractId));
    const charge = await charges.findByReference(contractId, 'installment:1');
    await collect(charge, 'succeeded');
    const paidInstallments = (plan: Awaited<ReturnType<typeof plans.findByContractId>>) =>
      plan?.terms.kind === 'installments' ? plan.terms.paidInstallments : null;
    await until(
      () => plans.findByContractId(contractId),
      (plan) => {
        expect(paidInstallments(plan)).toEqual([1]);
      },
    );
    const collected = await charges.findById(charge?.id ?? '');
    const returned = new RecordPaymentResultCommand({
      reference: collected?.currentAttempt?.key ?? '',
      paymentId: collected?.currentAttempt?.paymentId ?? '',
      outcome: 'returned',
      failureReason: 'MD06',
    });

    await commands.execute(returned);
    await commands.execute(returned);

    const plan = await until(
      () => plans.findByContractId(contractId),
      (found) => {
        expect(paidInstallments(found)).toEqual([]);
      },
    );
    expect(plan?.status).toBe('active');
    const statement = await until(
      () => app.get(QueryBus).execute(new GetStatementQuery(OPS, contractId)),
      (found) => {
        expect(found.entries).toHaveLength(3);
      },
    );
    expect(statement.entries.map((entry) => entry.type)).toEqual(['charge', 'payment', 'return']);
    expect(statement.balanceCents).toBe(charge?.amount.cents);
    expect(await charges.findById(charge?.id ?? '')).toMatchObject({
      status: 'failed',
      paidAt: null,
    });
  }, 60_000);

  // The last payment the ISA allows is charged: no month is assessed any more, but the contract
  // is still being repaid (a mandate can be signed, arrears and default apply) until billing has
  // collected it. Then the plan and the contract end.
  it('should end an ISA only once its last month charged is collected', async () => {
    const contract = anActiveContract({ terms: { product: anIsa({ maxPayments: 1 }) } });
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await contracts.save(contract);
      await plans.save(
        aPlan({
          contractId: contract.id,
          product: anIsa({ maxPayments: 1 }),
          activatedOn: '2026-01-05',
        }),
      );
      await app
        .get<IncomeDeclarationRepository>(INCOME_DECLARATION_REPOSITORY)
        .save(aDeclaration({ contractId: contract.id, period: '2026-07', incomeCents: 2_000_00 }));
    });
    const student: Principal = {
      kind: 'user',
      userId: contract.studentId,
      roles: ['student'],
      centerId: null,
    };

    await commands.execute(
      new RunBillingNowCommand(OPS, CalendarDate.parse('2026-08-05'), contract.id),
    );
    const assessed = await plans.findByContractId(contract.id);
    await commands.execute(new SignMandateCommand(student, contract.id, STUDENT_IBAN));
    const charge = await until(
      () => charges.findByReference(contract.id, 'isa:2026-07'),
      (found) => {
        expect(found?.status).toBe('pending');
      },
    );

    expect(assessed).toMatchObject({ status: 'active', assessmentsEnded: true });
    expect((await contracts.findById(contract.id))?.status).toBe('active');
    await collect(charge, 'succeeded');
    await until(
      () => contracts.findById(contract.id),
      (found) => {
        expect(found?.status).toBe('completed');
      },
    );
    expect(await plans.findByContractId(contract.id)).toMatchObject({
      status: 'completed',
      completionReason: 'max_payments',
    });
  }, 60_000);

  // ADR 017: lending assesses the ISA month in billing's transaction. When the charge cannot be
  // written, the assessment is rolled back with it and the next run assesses the month again.
  it('should roll back the ISA assessment when its charge is not written', async () => {
    const contract = anActiveContract({ terms: { product: anIsa() } });
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(async () => {
      await contracts.save(contract);
      await plans.save(
        aPlan({ contractId: contract.id, product: anIsa(), activatedOn: '2026-01-05' }),
      );
      await app
        .get<IncomeDeclarationRepository>(INCOME_DECLARATION_REPOSITORY)
        .save(aDeclaration({ contractId: contract.id, period: '2026-07', incomeCents: 2_000_00 }));
    });
    // July's declarations close on 5 August, when the month is assessed.
    const asOf = CalendarDate.parse('2026-08-05');
    const save = jest.spyOn(charges, 'save').mockRejectedValueOnce(new Error('disk full'));

    const failed = await commands.execute(new RunBillingNowCommand(OPS, asOf, contract.id));
    const untouched = await plans.findByContractId(contract.id);
    save.mockRestore();
    const retried = await commands.execute(new RunBillingNowCommand(OPS, asOf, contract.id));

    expect(failed.failedContractIds).toEqual([contract.id]);
    expect(untouched?.terms.kind === 'isa' && untouched.terms.lastAssessedPeriod).toBeNull();
    expect(retried).toMatchObject({ chargesCreated: 1, failedContractIds: [] });
    expect((await charges.findByReference(contract.id, 'isa:2026-07'))?.amount.cents).toBe(200_00);
    const plan = await plans.findByContractId(contract.id);
    expect(plan?.terms.kind === 'isa' && plan.terms.paymentsMade).toBe(1);
  }, 60_000);

  it('should put the contract in arrears at 30 days and default it at 90', async () => {
    const { contractId, firstDue } = await repaying(false);
    await commands.execute(new RunBillingNowCommand(OPS, firstDue, contractId));

    await commands.execute(new RunDunningNowCommand(OPS, firstDue.addDays(30), contractId));
    await until(
      () => contracts.findById(contractId),
      (contract) => {
        expect(contract?.status).toBe('in_arrears');
      },
    );
    await commands.execute(new RunDunningNowCommand(OPS, firstDue.addDays(90), contractId));

    await until(
      () => contracts.findById(contractId),
      (contract) => {
        expect(contract?.status).toBe('defaulted');
      },
    );
    expect((await charges.findByReference(contractId, 'installment:1'))?.status).toBe(
      'written_off',
    );
    // The plan closes with the default (lending.close-plan), and the contract stays defaulted.
    await until(
      () => plans.findByContractId(contractId),
      (plan) => {
        expect(plan).toMatchObject({ status: 'completed', completionReason: 'defaulted' });
      },
    );
    expect((await contracts.findById(contractId))?.status).toBe('defaulted');
    // Instalment 1 was written off by dunning; the principal of 2 to 24 is raised at once and
    // written off with the default (billing.close-defaulted).
    const plan = await plans.findByContractId(contractId);
    const leftToBill = (plan?.terms.kind === 'installments' ? plan.terms.schedule : [])
      .filter((row) => row.number > 1)
      .reduce((sum, row) => sum + row.principal.cents, 0);
    const accelerated = await until(
      () => charges.findByReference(contractId, 'accelerated'),
      (charge) => {
        expect(charge?.status).toBe('written_off');
      },
    );
    expect(accelerated?.amount.cents).toBe(leftToBill);
    // Dated by the dunning run that wrote instalment 1 off, not by the clock.
    expect(accelerated?.dueDate.toString()).toBe(firstDue.addDays(90).toString());
  }, 60_000);

  // The payoff charge being collected for a contract (one per request).
  async function payoffOf(contractId: string): Promise<Charge | null> {
    const rows = await app
      .get(DataSource)
      .query<{ id: string }[]>(
        `SELECT id FROM billing.charges WHERE contract_id = $1 AND kind = 'payoff' AND status = 'pending'`,
        [contractId],
      );
    return rows[0] ? charges.findById(rows[0].id) : null;
  }

  it('should collect a payoff the student asked for and close the plan and the contract', async () => {
    const { contractId, student } = await repaying(true);

    await commands.execute(new RequestPayoffCommand(student, contractId, 7_500_00));
    const payoff = await until(
      () => payoffOf(contractId),
      (charge) => {
        expect(charge?.status).toBe('pending');
      },
    );
    await collect(payoff, 'succeeded');

    await until(
      () => contracts.findById(contractId),
      (contract) => {
        expect(contract?.status).toBe('completed');
      },
    );
    expect((await plans.findByContractId(contractId))?.completionReason).toBe('paid_off');
  }, 60_000);

  it('should withdraw a payoff the bank refused, so the student may ask again', async () => {
    const { contractId, student } = await repaying(true);

    await commands.execute(new RequestPayoffCommand(student, contractId, 7_500_00));
    const payoff = await until(
      () => payoffOf(contractId),
      (charge) => {
        expect(charge?.status).toBe('pending');
      },
    );
    await collect(payoff, 'failed');

    await until(
      () => plans.findByContractId(contractId),
      (plan) => {
        expect(plan?.terms.kind === 'installments' && plan.terms.payoffRequest).toBeNull();
      },
    );
    expect((await charges.findById(payoff?.id ?? ''))?.status).toBe('cancelled');
    expect((await contracts.findById(contractId))?.status).toBe('active');
  }, 60_000);
});
