import { uuidv7 } from 'uuidv7';

import { type Principal } from '@shared/application';
import { CalendarDate, EntityNotFoundError, FixedClock, InvalidValueError } from '@shared/domain';

import {
  A_CREDITOR,
  aContract,
  aContractSentForSignature,
  aDisbursement,
  anActiveContract,
  anIsa,
  aPlan,
  NOW,
} from '../../../../test/factories/lending';
import {
  InMemoryContractQueries,
  InMemoryContractRepository,
  InMemoryDisbursementRepository,
  InMemoryFinancingPlanRepository,
} from '../../../../test/fakes/lending';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  type Contract,
  ContractAccessDeniedError,
  PlanNotOpenError,
  renderContractDocument,
} from '../domain';

import { AssessIsaPeriodHandler } from './commands/assess-isa-period.command';
import { FindContractQuery } from './dto/contract-lookup';
import { AssessIsaPeriodCommand, FindUnpaidPrincipalQuery } from './dto/plan-lookup';
import { FindContractHandler } from './queries/find-contract.query';
import { FindUnpaidPrincipalHandler } from './queries/find-unpaid-principal.query';
import {
  GetContractDocumentHandler,
  GetContractDocumentQuery,
} from './queries/get-contract-document.query';
import {
  GetContractScheduleHandler,
  GetContractScheduleQuery,
} from './queries/get-contract-schedule.query';
import { GetContractHandler, GetContractQuery } from './queries/get-contract.query';
import { GetPayoffQuoteHandler, GetPayoffQuoteQuery } from './queries/get-payoff-quote.query';
import { ListContractsHandler, ListContractsQuery } from './queries/list-contracts.query';
import {
  ListDisbursementsHandler,
  ListDisbursementsQuery,
} from './queries/list-disbursements.query';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };
const PAGE = { limit: 20 };

const studentOf = (contract: Contract): Principal => ({
  kind: 'user',
  userId: contract.studentId,
  roles: ['student'],
  centerId: null,
});
const adminOf = (contract: Contract): Principal => ({
  kind: 'user',
  userId: uuidv7(),
  roles: ['center_admin'],
  centerId: contract.centerId,
});
const keyOf = (
  contract: Contract,
  scopes: ('portfolio:read' | 'applications:read')[],
): Principal => ({
  kind: 'api_key',
  apiKeyId: uuidv7(),
  centerId: contract.centerId,
  scopes,
});

function setup() {
  const events = new RecordingEventBus();
  const contracts = new InMemoryContractRepository(events);
  const disbursements = new InMemoryDisbursementRepository(events);
  const plans = new InMemoryFinancingPlanRepository(events);
  const queries = new InMemoryContractQueries(contracts, disbursements, plans);
  const clock = new FixedClock(NOW);
  return {
    contracts,
    disbursements,
    plans,
    clock,
    get: new GetContractHandler(contracts, disbursements),
    list: new ListContractsHandler(queries),
    schedule: new GetContractScheduleHandler(contracts, plans),
    quote: new GetPayoffQuoteHandler(contracts, plans, clock),
    document: new GetContractDocumentHandler(contracts),
    listDisbursements: new ListDisbursementsHandler(queries),
  };
}

// An active contract with its settled disbursement and its plan, opened today.
async function anActiveContractWithPlan(t: ReturnType<typeof setup>): Promise<Contract> {
  const contract = anActiveContract();
  const disbursement = aDisbursement({ contractId: contract.id, centerId: contract.centerId });
  disbursement.startTransfer(A_CREDITOR);
  disbursement.markSent('tr-1', NOW);
  disbursement.settle(NOW);
  await t.contracts.save(contract);
  await t.disbursements.save(disbursement);
  await t.plans.save(
    aPlan({ contractId: contract.id, activatedOn: CalendarDate.fromInstant(NOW).toString() }),
  );
  return contract;
}

describe('lending queries', () => {
  describe('GetContract', () => {
    it('should show the student the terms, not what the center is paid', async () => {
      const t = setup();
      const contract = await anActiveContractWithPlan(t);

      const dto = await t.get.execute(new GetContractQuery(studentOf(contract), contract.id));

      expect(dto).toMatchObject({
        id: contract.id,
        status: 'active',
        principalCents: 7_500_00,
        product: { kind: 'installments', termMonths: 24, aprBasisPoints: 776 },
        payout: null,
      });
    });

    it('should show the center and staff the payout and how the disbursement went', async () => {
      const t = setup();
      const contract = await anActiveContractWithPlan(t);

      for (const actor of [adminOf(contract), keyOf(contract, ['portfolio:read']), OPS]) {
        const dto = await t.get.execute(new GetContractQuery(actor, contract.id));
        expect(dto.payout).toEqual({
          platformFeeBasisPoints: 500,
          disbursementAmountCents: 7_125_00,
          disbursementStatus: 'settled',
          settledAt: NOW,
        });
      }
    });

    it('should hide a contract from other students, other centers and keys without the scope', async () => {
      const t = setup();
      const contract = aContract();
      await t.contracts.save(contract);
      const others: Principal[] = [
        { ...studentOf(contract), userId: uuidv7() } as Principal,
        { ...adminOf(contract), centerId: uuidv7() } as Principal,
        keyOf(contract, ['applications:read']),
      ];

      for (const actor of others) {
        await expect(t.get.execute(new GetContractQuery(actor, contract.id))).rejects.toThrow(
          EntityNotFoundError,
        );
      }
    });
  });

  describe('ListContracts', () => {
    it('should scope the list to the caller', async () => {
      const t = setup();
      const mine = aContract();
      const sameCenter = aContract({ centerId: mine.centerId });
      const elsewhere = aContract();
      for (const contract of [mine, sameCenter, elsewhere]) await t.contracts.save(contract);
      const ids = async (actor: Principal) =>
        (await t.list.execute(new ListContractsQuery(actor, {}, PAGE))).data.map((c) => c.id);

      expect(await ids(studentOf(mine))).toEqual([mine.id]);
      expect(new Set(await ids(adminOf(mine)))).toEqual(new Set([mine.id, sameCenter.id]));
      expect(await ids(keyOf(mine, ['applications:read']))).toEqual([]);
      expect(await ids(OPS)).toHaveLength(3);
      expect(
        (await t.list.execute(new ListContractsQuery(OPS, { centerId: elsewhere.centerId }, PAGE)))
          .data,
      ).toHaveLength(1);
    });
  });

  describe('schedule, payoff quote and document', () => {
    it('should give the student the instalment table, and not the center', async () => {
      const t = setup();
      const contract = await anActiveContractWithPlan(t);

      const schedule = await t.schedule.execute(
        new GetContractScheduleQuery(studentOf(contract), contract.id),
      );

      expect(schedule).toMatchObject({ kind: 'installments', installmentsPaid: 0 });
      if (schedule.kind === 'installments') {
        expect(schedule.installments).toHaveLength(24);
        expect(schedule.installments[0]).toMatchObject({ totalCents: 337_50, paid: false });
      }
      await expect(
        t.schedule.execute(new GetContractScheduleQuery(adminOf(contract), contract.id)),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should have no schedule before the contract is active', async () => {
      const t = setup();
      const contract = aContractSentForSignature();
      await t.contracts.save(contract);

      await expect(
        t.schedule.execute(new GetContractScheduleQuery(studentOf(contract), contract.id)),
      ).rejects.toThrow(PlanNotOpenError);
    });

    it('should quote a payoff for today or a day in the coming month', async () => {
      const t = setup();
      const contract = await anActiveContractWithPlan(t);
      const quote = (asOf?: string) =>
        t.quote.execute(new GetPayoffQuoteQuery(studentOf(contract), contract.id, asOf));

      expect(await quote()).toMatchObject({ asOf: '2026-10-12', totalCents: 7_500_00 });
      expect((await quote('2026-10-27')).accruedInterestCents).toBeGreaterThan(0);
      await expect(quote('2026-10-11')).rejects.toThrow(InvalidValueError);
      await expect(quote('2026-11-13')).rejects.toThrow(InvalidValueError);
    });

    // What was sent is what was signed, whatever the code renders today.
    it('should serve the text sent for signature, not a new rendering', async () => {
      const t = setup();
      const contract = aContractSentForSignature();
      await t.contracts.save(contract);

      const document = await t.document.execute(
        new GetContractDocumentQuery(studentOf(contract), contract.id),
      );

      expect(document).toBe(contract.signature?.document);
      expect(document).not.toBe(renderContractDocument(contract));
    });

    it('should render the document of a contract not yet sent', async () => {
      const t = setup();
      const contract = aContract();
      await t.contracts.save(contract);

      const document = await t.document.execute(
        new GetContractDocumentQuery(studentOf(contract), contract.id),
      );

      expect(document).toBe(renderContractDocument(contract));
    });
  });

  describe('facades for billing', () => {
    // Billing raises a defaulted loan's principal left to bill: the plan has ended by then.
    it('should tell billing the principal of each unpaid instalment, whatever the plan state', async () => {
      const t = setup();
      const plan = aPlan();
      plan.recordInstallmentPaid(1, NOW);
      plan.closeOnDefault(NOW);
      await t.plans.save(plan);
      const isa = aPlan({ product: anIsa() });
      await t.plans.save(isa);
      const handler = new FindUnpaidPrincipalHandler(t.plans);

      const unpaid = await handler.execute(new FindUnpaidPrincipalQuery(plan.contractId));

      const { schedule } = plan.terms.kind === 'installments' ? plan.terms : { schedule: [] };
      expect(unpaid).toHaveLength(23);
      expect(unpaid?.[0]).toEqual({ number: 2, principalCents: schedule[1]?.principal.cents });
      expect(await handler.execute(new FindUnpaidPrincipalQuery(isa.contractId))).toBeNull();
      expect(await handler.execute(new FindUnpaidPrincipalQuery(uuidv7()))).toBeNull();
    });

    it('should tell billing whose contract it is and in what state', async () => {
      const t = setup();
      const contract = anActiveContract();
      await t.contracts.save(contract);
      const handler = new FindContractHandler(t.contracts, t.plans);

      expect(await handler.execute(new FindContractQuery(contract.id))).toEqual({
        id: contract.id,
        studentId: contract.studentId,
        centerId: contract.centerId,
        product: 'installments',
        status: 'active',
        nextIsaPeriod: null,
      });
      expect(await handler.execute(new FindContractQuery(uuidv7()))).toBeNull();
    });

    it('should tell billing the next month of income an ISA has not assessed', async () => {
      const t = setup();
      const contract = anActiveContract({ terms: { product: anIsa() } });
      await t.contracts.save(contract);
      await t.plans.save(
        aPlan({ contractId: contract.id, product: anIsa(), activatedOn: '2026-01-05' }),
      );
      const assess = new AssessIsaPeriodHandler(new InlineUnitOfWork(), t.plans, t.clock);
      await assess.execute(new AssessIsaPeriodCommand(contract.id, '2026-07', 2_000_00));

      const found = await new FindContractHandler(t.contracts, t.plans).execute(
        new FindContractQuery(contract.id),
      );

      expect(found?.nextIsaPeriod).toBe('2026-08');
    });

    // The only payment the ISA allows: July ends the plan, and billing stops walking its months.
    it('should tell billing when the month assessed ends the plan', async () => {
      const t = setup();
      const product = anIsa({ maxPayments: 1 });
      const contract = anActiveContract({ terms: { product } });
      await t.contracts.save(contract);
      await t.plans.save(aPlan({ contractId: contract.id, product, activatedOn: '2026-01-05' }));
      const handler = new AssessIsaPeriodHandler(new InlineUnitOfWork(), t.plans, t.clock);

      const july = await handler.execute(
        new AssessIsaPeriodCommand(contract.id, '2026-07', 2_000_00),
      );

      expect(july).toEqual({ outcome: 'charge', amountCents: 200_00, planEnded: true });
    });

    // 10 % of the 2,000 declared for July 2026, the first month of the plan.
    it('should assess a month of an ISA for billing and keep the result', async () => {
      const t = setup();
      const contract = anActiveContract({ terms: { product: anIsa() } });
      await t.contracts.save(contract);
      await t.plans.save(
        aPlan({ contractId: contract.id, product: anIsa(), activatedOn: '2026-01-05' }),
      );
      const handler = new AssessIsaPeriodHandler(new InlineUnitOfWork(), t.plans, t.clock);

      const before = await handler.execute(
        new AssessIsaPeriodCommand(contract.id, '2026-06', null),
      );
      const july = await handler.execute(
        new AssessIsaPeriodCommand(contract.id, '2026-07', 2_000_00),
      );
      const august = await handler.execute(
        new AssessIsaPeriodCommand(contract.id, '2026-08', null),
      );

      expect(before).toEqual({ outcome: 'not_started', planEnded: false });
      expect(july).toEqual({ outcome: 'charge', amountCents: 200_00, planEnded: false });
      expect(august).toEqual({ outcome: 'paused', reason: 'no_declaration', planEnded: false });
      const plan = await t.plans.findByContractId(contract.id);
      expect(plan?.terms.kind === 'isa' && plan.terms.paymentsMade).toBe(1);
      await expect(
        handler.execute(new AssessIsaPeriodCommand(uuidv7(), '2026-07', null)),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('ListDisbursements', () => {
    it('should list disbursements by status for staff only', async () => {
      const t = setup();
      const failed = aDisbursement();
      failed.fail('account_closed', NOW);
      await t.disbursements.save(failed);
      await t.disbursements.save(aDisbursement());

      const page = await t.listDisbursements.execute(
        new ListDisbursementsQuery(OPS, { status: 'failed' }, PAGE),
      );

      expect(page.data.map((item) => item.id)).toEqual([failed.id]);
      await expect(
        t.listDisbursements.execute(new ListDisbursementsQuery(studentOf(aContract()), {}, PAGE)),
      ).rejects.toThrow(ContractAccessDeniedError);
    });
  });
});
