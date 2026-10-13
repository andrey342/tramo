import { type ContractQueries } from '../../src/modules/lending/application/ports/lending-ports';
import {
  type Contract,
  type ContractRepository,
  type DisbursementRepository,
  type FinancingPlan,
  type FinancingPlanRepository,
  LendingRecordExistsError,
} from '../../src/modules/lending/domain';
import { CalendarDate, Money } from '../../src/shared/domain';
import {
  A_CREDITOR,
  aContract,
  aContractSentForSignature,
  aDisbursement,
  anActiveContract,
  anIsa,
  aPlan,
  aSignedContract,
  LATER,
  NOW,
} from '../factories/lending';

export interface LendingRepositoriesHarness {
  readonly contracts: ContractRepository;
  readonly disbursements: DisbursementRepository;
  readonly plans: FinancingPlanRepository;
  readonly queries: ContractQueries;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

const contractState = (contract: Contract) => ({
  applicationId: contract.applicationId,
  studentId: contract.studentId,
  centerId: contract.centerId,
  program: contract.program,
  terms: contract.terms,
  signature: contract.signature,
  activatedOn: contract.activatedOn,
  cancellationReason: contract.cancellationReason,
  status: contract.status,
  statusChangedAt: contract.statusChangedAt,
  createdAt: contract.createdAt,
});

const planState = (plan: FinancingPlan) => ({
  contractId: plan.contractId,
  principal: plan.principal,
  startsOn: plan.startsOn,
  terms: plan.terms,
  status: plan.status,
  completionReason: plan.completionReason,
  completedAt: plan.completedAt,
});

// The in-memory repositories of unit tests and the TypeORM ones agree on what is stored, what is
// found and what is refused.
export function lendingRepositoriesContract(
  name: string,
  create: () => Promise<LendingRepositoriesHarness> | LendingRepositoriesHarness,
): void {
  describe(`${name} (lending repositories contract)`, () => {
    it('should store a contract through signature and activation, terms intact', async () => {
      const { contracts, run } = await create();
      const isa = aContractSentForSignature({ terms: { product: anIsa() } });
      const active = anActiveContract();
      await run(async () => {
        await contracts.save(isa);
        await contracts.save(active);
      });

      for (const contract of [isa, active]) {
        const found = await run(() => contracts.findById(contract.id));
        expect(found && contractState(found)).toEqual(contractState(contract));
      }
      const envelopeId = isa.signature?.envelopeId ?? '';
      expect((await run(() => contracts.findByEnvelopeId(envelopeId)))?.id).toBe(isa.id);
      expect((await run(() => contracts.findByApplicationId(active.applicationId)))?.id).toBe(
        active.id,
      );
      expect(await run(() => contracts.findByEnvelopeId('unknown-envelope'))).toBeNull();
    });

    it('should refuse a second contract for the same application', async () => {
      const { contracts, run } = await create();
      const contract = aContract();
      await run(() => contracts.save(contract));
      const twin = aContract();
      Object.defineProperty(twin, 'applicationId', { value: contract.applicationId });

      await expect(run(() => contracts.save(twin))).rejects.toThrow(LendingRecordExistsError);
    });

    it('should store a disbursement and one only per contract', async () => {
      const { contracts, disbursements, run } = await create();
      const contract = anActiveContract();
      const disbursement = aDisbursement({ contractId: contract.id, centerId: contract.centerId });
      await run(async () => {
        await contracts.save(contract);
        await disbursements.save(disbursement);
      });
      disbursement.startTransfer(A_CREDITOR);
      disbursement.markSent('tr-1', LATER);
      disbursement.fail('account_closed', LATER);
      await run(() => disbursements.save(disbursement));

      const found = await run(() => disbursements.findByContractId(contract.id));
      expect(found).toMatchObject({
        id: disbursement.id,
        status: 'failed',
        transferId: 'tr-1',
        failureReason: 'account_closed',
        attempt: 1,
      });
      expect(found?.amount).toEqual(Money.fromCents(7_125_00));
      await expect(
        run(() => disbursements.save(aDisbursement({ contractId: contract.id }))),
      ).rejects.toThrow(LendingRecordExistsError);
    });

    it('should store a signed contract cancelled with its failed disbursement', async () => {
      const { contracts, disbursements, run } = await create();
      const contract = aSignedContract();
      const disbursement = aDisbursement({ contractId: contract.id, centerId: contract.centerId });
      disbursement.fail('center_not_active', LATER);
      await run(async () => {
        await contracts.save(contract);
        await disbursements.save(disbursement);
      });
      disbursement.cancel(LATER);
      contract.cancel('disbursement_failed', LATER);
      await run(async () => {
        await disbursements.save(disbursement);
        await contracts.save(contract);
      });

      const found = await run(() => contracts.findById(contract.id));
      expect(found && contractState(found)).toEqual(contractState(contract));
      expect(found?.signature?.signedAt).toEqual(NOW);
      expect(await run(() => disbursements.findByContractId(contract.id))).toMatchObject({
        status: 'cancelled',
        failureReason: 'center_not_active',
      });
    });

    it('should store both kinds of plan with their state', async () => {
      const { contracts, plans, run } = await create();
      const [first, second] = [anActiveContract(), anActiveContract()];
      const installments = aPlan({ contractId: first.id });
      installments.recordInstallmentPaid(1, LATER);
      const payoffDay = CalendarDate.parse('2026-11-20');
      installments.requestPayoff(payoffDay, installments.payoffQuote(payoffDay).total, LATER);
      const isa = aPlan({ contractId: second.id, product: anIsa(), activatedOn: '2026-01-05' });
      isa.assessPeriod(CalendarDate.parse('2026-07-01'), null, LATER);
      isa.assessPeriod(CalendarDate.parse('2026-08-01'), Money.fromCents(2_000_00), LATER);
      await run(async () => {
        await contracts.save(first);
        await contracts.save(second);
        await plans.save(installments);
        await plans.save(isa);
      });

      for (const plan of [installments, isa]) {
        const found = await run(() => plans.findByContractId(plan.contractId));
        expect(found && planState(found)).toEqual(planState(plan));
      }
      await expect(run(() => plans.save(aPlan({ contractId: first.id })))).rejects.toThrow(
        LendingRecordExistsError,
      );
    });

    it('should list contracts by student, center and status, newest first, a page at a time', async () => {
      const { contracts, queries, run } = await create();
      const first = aContract();
      const second = aContract({ studentId: first.studentId, centerId: first.centerId });
      const third = anActiveContract({ centerId: first.centerId });
      Object.defineProperty(third, 'createdAt', { value: LATER });
      await run(async () => {
        for (const contract of [first, second, third]) await contracts.save(contract);
      });

      const byCenter = await run(() => queries.list({ centerId: first.centerId }, { limit: 2 }));
      const rest = await run(() =>
        queries.list({ centerId: first.centerId }, { limit: 2, cursor: byCenter.nextCursor ?? '' }),
      );
      const byStudent = await run(() =>
        queries.list({ studentId: first.studentId }, { limit: 10 }),
      );
      const active = await run(() =>
        queries.list({ centerId: first.centerId, status: 'active' }, { limit: 10 }),
      );

      expect(byCenter.data[0]).toMatchObject({
        id: third.id,
        programName: 'Full Stack Bootcamp',
        principalCents: 7_500_00,
        product: 'installments',
        status: 'active',
      });
      expect([...byCenter.data, ...rest.data].map((c) => c.id).sort()).toEqual(
        [first.id, second.id, third.id].sort(),
      );
      expect(rest.nextCursor).toBeNull();
      expect(byStudent.data.map((c) => c.id).sort()).toEqual([first.id, second.id].sort());
      expect(active.data.map((c) => c.id)).toEqual([third.id]);
    });

    it('should page through the plans being repaid, with what is left to bill', async () => {
      const { contracts, plans, queries, run } = await create();
      const [repaying, inArrears, defaulted, isaContract] = [
        anActiveContract(),
        anActiveContract(),
        anActiveContract(),
        anActiveContract({ terms: { product: anIsa() } }),
      ];
      inArrears.markInArrears(LATER, LATER);
      defaulted.declareDefault(LATER);
      const paidOne = aPlan({ contractId: repaying.id });
      paidOne.recordInstallmentPaid(1, LATER);
      const isa = aPlan({
        contractId: isaContract.id,
        product: anIsa(),
        activatedOn: '2026-01-05',
      });
      await run(async () => {
        for (const contract of [repaying, inArrears, defaulted, isaContract]) {
          await contracts.save(contract);
        }
        await plans.save(paidOne);
        await plans.save(aPlan({ contractId: inArrears.id }));
        await plans.save(aPlan({ contractId: defaulted.id }));
        await plans.save(isa);
      });
      const ours = new Set([repaying.id, inArrears.id, defaulted.id, isaContract.id]);

      const all = [];
      let after: string | null = null;
      for (;;) {
        const page = await run(() => queries.billablePlans(after, 2));
        all.push(...page.filter((plan) => ours.has(plan.contractId)));
        if (page.length < 2) break;
        after = page.at(-1)?.contractId ?? null;
      }

      expect(all.map((plan) => plan.contractId).sort()).toEqual(
        [repaying.id, inArrears.id, isaContract.id].sort(),
      );
      const first = all.find((plan) => plan.contractId === repaying.id);
      expect(first).toMatchObject({ kind: 'installments', contractStatus: 'active' });
      expect(first?.unpaidInstallments).toHaveLength(23);
      expect(first?.unpaidInstallments[0]).toEqual({
        number: 2,
        dueDate: '2026-12-12',
        totalCents: 337_50,
      });
      expect(all.find((plan) => plan.contractId === inArrears.id)?.contractStatus).toBe(
        'in_arrears',
      );
      expect(all.find((plan) => plan.contractId === isaContract.id)).toMatchObject({
        kind: 'isa',
        unpaidInstallments: [],
        nextIsaPeriod: '2026-07',
      });
    });

    // A payoff being collected covers what is left; the cycle bills nothing else meanwhile.
    it('should leave out a plan whose payoff is being collected, and narrow to one contract', async () => {
      const { contracts, plans, queries, run } = await create();
      const [payingOff, other] = [anActiveContract(), anActiveContract()];
      const plan = aPlan({ contractId: payingOff.id });
      plan.recordInstallmentPaid(1, LATER);
      const payoffDay = CalendarDate.parse('2026-11-20');
      plan.requestPayoff(payoffDay, plan.payoffQuote(payoffDay).total, LATER);
      await run(async () => {
        await contracts.save(payingOff);
        await contracts.save(other);
        await plans.save(plan);
        await plans.save(aPlan({ contractId: other.id }));
      });

      const narrowed = await run(() => queries.billablePlans(null, 50, payingOff.id));
      const onlyOther = await run(() => queries.billablePlans(null, 50, other.id));

      expect(narrowed).toEqual([]);
      expect(onlyOther.map((billable) => billable.contractId)).toEqual([other.id]);
    });

    it('should list disbursements by status', async () => {
      const { contracts, disbursements, queries, run } = await create();
      const [paid, bounced] = [anActiveContract(), anActiveContract()];
      const settled = aDisbursement({ contractId: paid.id });
      settled.startTransfer(A_CREDITOR);
      settled.markSent('tr-1', NOW);
      settled.settle(NOW);
      const failed = aDisbursement({ contractId: bounced.id });
      failed.fail('no_payout_account', NOW);
      await run(async () => {
        await contracts.save(paid);
        await contracts.save(bounced);
        await disbursements.save(settled);
        await disbursements.save(failed);
      });

      const page = await run(() => queries.listDisbursements({ status: 'failed' }, { limit: 50 }));

      expect(page.data.map((item) => item.id)).toContain(failed.id);
      expect(page.data.map((item) => item.id)).not.toContain(settled.id);
      expect(page.data.find((item) => item.id === failed.id)).toMatchObject({
        status: 'failed',
        failureReason: 'no_payout_account',
        amountCents: 7_125_00,
      });
    });
  });
}
