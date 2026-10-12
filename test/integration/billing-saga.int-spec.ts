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
import { type Charge, CHARGE_REPOSITORY, type ChargeRepository } from '@modules/billing/domain';
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

import { STUDENT_IBAN } from '../factories/billing';
import { anActiveContract, aPlan } from '../factories/lending';
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

    const run = await commands.execute(new RunBillingNowCommand(OPS, firstDue));
    const charge = await charges.findByReference(contractId, 'installment:1');
    await collect(charge, 'succeeded');

    // Other suites leave plans due the same day: the run bills them too.
    expect(run.chargesCreated).toBeGreaterThanOrEqual(1);
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

  it('should put the contract in arrears at 30 days and default it at 90', async () => {
    const { contractId, firstDue } = await repaying(false);
    await commands.execute(new RunBillingNowCommand(OPS, firstDue));

    await commands.execute(new RunDunningNowCommand(OPS, firstDue.addDays(30)));
    await until(
      () => contracts.findById(contractId),
      (contract) => {
        expect(contract?.status).toBe('in_arrears');
      },
    );
    await commands.execute(new RunDunningNowCommand(OPS, firstDue.addDays(90)));

    await until(
      () => contracts.findById(contractId),
      (contract) => {
        expect(contract?.status).toBe('defaulted');
      },
    );
    expect((await charges.findByReference(contractId, 'installment:1'))?.status).toBe(
      'written_off',
    );
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
