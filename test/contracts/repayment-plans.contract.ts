import { type RepaymentPlans } from '../../src/modules/billing/application/ports/billing-ports';

export interface RepaymentPlansHarness {
  readonly plans: RepaymentPlans;
  // An active instalment contract of 24 monthly instalments of 337.50, the first paid.
  readonly installmentsContractId: string;
  readonly studentId: string;
  // An active ISA (10 % of income from 1,500 a month) whose first month is 2026-07.
  readonly isaContractId: string;
}

const UNKNOWN = '0199a000-0000-7000-8000-0000000000ff';

// The fake of unit tests and the adapter that asks lending agree on what billing reads and on
// what an ISA month comes to.
export function repaymentPlansContract(
  name: string,
  create: () => Promise<RepaymentPlansHarness> | RepaymentPlansHarness,
): void {
  describe(`${name} (RepaymentPlans contract)`, () => {
    it('should find a contract with its student, product and state', async () => {
      const { plans, installmentsContractId, studentId } = await create();

      expect(await plans.findContract(installmentsContractId)).toEqual({
        id: installmentsContractId,
        studentId,
        centerId: expect.any(String),
        product: 'installments',
        status: 'active',
      });
      expect(await plans.findContract(UNKNOWN)).toBeNull();
    });

    it('should list the plans being repaid with what is left to bill', async () => {
      const { plans, installmentsContractId, isaContractId } = await create();

      const billable = [];
      let after: string | null = null;
      for (;;) {
        const page = await plans.billablePlans(after, 50);
        billable.push(...page);
        if (page.length < 50) break;
        after = page.at(-1)?.contractId ?? null;
      }

      const installments = billable.find((plan) => plan.contractId === installmentsContractId);
      expect(installments?.unpaidInstallments).toHaveLength(23);
      expect(installments?.unpaidInstallments[0]).toMatchObject({ number: 2, totalCents: 337_50 });
      expect(billable.find((plan) => plan.contractId === isaContractId)).toMatchObject({
        kind: 'isa',
        nextIsaPeriod: '2026-07',
      });
    });

    it('should assess an ISA month by the income declared', async () => {
      const { plans, isaContractId } = await create();

      expect(await plans.assessIsaPeriod(isaContractId, '2026-07', 2_000_00)).toEqual({
        outcome: 'charge',
        amountCents: 200_00,
      });
      expect((await plans.assessIsaPeriod(isaContractId, '2026-08', null)).outcome).toBe('paused');
    });
  });
}
