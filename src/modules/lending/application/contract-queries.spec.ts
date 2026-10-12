import { uuidv7 } from 'uuidv7';

import { type Principal } from '@shared/application';
import { CalendarDate, EntityNotFoundError, FixedClock, InvalidValueError } from '@shared/domain';

import {
  A_CREDITOR,
  aContract,
  aContractSentForSignature,
  aDisbursement,
  anActiveContract,
  aPlan,
  NOW,
} from '../../../../test/factories/lending';
import {
  InMemoryContractQueries,
  InMemoryContractRepository,
  InMemoryDisbursementRepository,
  InMemoryFinancingPlanRepository,
} from '../../../../test/fakes/lending';
import { RecordingEventBus } from '../../../../test/fakes/shared';
import { type Contract, ContractAccessDeniedError, renderContractDocument } from '../domain';

import { documentHash } from './commands/send-contract-for-signature.command';
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
  const queries = new InMemoryContractQueries(contracts, disbursements);
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
      ).rejects.toThrow(EntityNotFoundError);
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

    it('should serve the document whose hash the signature carries', async () => {
      const t = setup();
      const contract = aContractSentForSignature();
      await t.contracts.save(contract);

      const document = await t.document.execute(
        new GetContractDocumentQuery(studentOf(contract), contract.id),
      );

      expect(document).toBe(renderContractDocument(contract));
      expect(documentHash(document)).toMatch(/^[0-9a-f]{64}$/);
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
