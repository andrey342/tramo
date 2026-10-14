import { uuidv7 } from 'uuidv7';

import { type BillingQueries } from '../../src/modules/billing/application/ports/billing-ports';
import {
  type Charge,
  type ChargeRepository,
  type IncomeDeclarationRepository,
  type PaymentMandateRepository,
} from '../../src/modules/billing/domain';
import { aCharge, aDeclaration, aMandate, day, LATER, NOW } from '../factories/billing';

export interface BillingRepositoriesHarness {
  readonly charges: ChargeRepository;
  readonly mandates: PaymentMandateRepository;
  readonly declarations: IncomeDeclarationRepository;
  readonly queries: BillingQueries;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

const state = (charge: Charge) => ({
  contractId: charge.contractId,
  studentId: charge.studentId,
  centerId: charge.centerId,
  kind: charge.kind,
  reference: charge.reference,
  installmentNumber: charge.installmentNumber,
  period: charge.period,
  amount: charge.amount,
  dueDate: charge.dueDate,
  status: charge.status,
  attempts: charge.attempts,
  dunningStep: charge.dunningStep,
  paidAt: charge.paidAt,
});

// The in-memory repositories of unit tests and the TypeORM ones agree on what is stored, found
// and refused.
export function billingRepositoriesContract(
  name: string,
  create: () => Promise<BillingRepositoriesHarness> | BillingRepositoriesHarness,
): void {
  describe(`${name} (billing repositories contract)`, () => {
    it('should store a charge through collection and dunning, and find it by reference', async () => {
      const { charges, run } = await create();
      const charge = aCharge();
      charge.applyDunning(day('2026-11-20'), NOW);
      const key = charge.submitCollection(uuidv7(), NOW);
      charge.recordAccepted(key, 'pay-1');
      charge.recordSucceeded(key, LATER, false);
      await run(() => charges.save(charge));

      const found = await run(() => charges.findById(charge.id));
      expect(found && state(found)).toEqual(state(charge));
      expect(
        (await run(() => charges.findByReference(charge.contractId, 'installment:1')))?.id,
      ).toBe(charge.id);
      expect(
        await run(() => charges.findByReference(charge.contractId, 'installment:9')),
      ).toBeNull();
    });

    it('should refuse a second charge for the same reference', async () => {
      const { charges, run } = await create();
      const charge = aCharge();
      await run(() => charges.save(charge));

      await expect(
        run(() => charges.save(aCharge({ contractId: charge.contractId }))),
      ).rejects.toMatchObject({ code: 'concurrent_charge' });
    });

    it('should find what collection, dunning and the end of a plan work on', async () => {
      const { charges, run } = await create();
      const contractId = uuidv7();
      const due = aCharge({ contractId, reference: 'installment:1' });
      const later = aCharge({ contractId, reference: 'installment:2', dueDate: '2026-12-12' });
      const paid = aCharge({ contractId, reference: 'installment:3' });
      paid.recordSucceeded(paid.submitCollection(uuidv7(), NOW), NOW, false);
      const collecting = aCharge({ contractId, reference: 'installment:4' });
      collecting.submitCollection(uuidv7(), NOW);
      const failed = aCharge({ contractId, reference: 'installment:5' });
      failed.recordFailed(
        failed.submitCollection(uuidv7(), NOW),
        'insufficient_funds',
        day('2026-11-12'),
        NOW,
      );
      await run(async () => {
        for (const charge of [due, later, paid, collecting, failed]) await charges.save(charge);
      });
      const ours = (ids: string[]) =>
        ids
          .filter((id) => [due.id, later.id, paid.id, collecting.id, failed.id].includes(id))
          .sort();

      expect(ours(await run(() => charges.findDueIds(day('2026-11-12'), 1_000, null)))).toEqual([
        due.id,
      ]);
      expect(ours(await run(() => charges.findUnsettledIds(10_000, null)))).toEqual(
        [due.id, later.id, collecting.id, failed.id].sort(),
      );
      const open = await run(() => charges.findOpen(contractId));
      expect(open.map((charge) => charge.id)).toEqual([due.id, later.id, failed.id].sort());
      // Loaded whole: they come back as saved and can be changed and saved again.
      const reloaded = open.find((charge) => charge.id === failed.id);
      expect(reloaded).toMatchObject({
        status: 'failed',
        attempts: failed.attempts,
        amount: failed.amount,
        dueDate: failed.dueDate,
      });
      expect(
        await run(() => charges.findDueIds(day('2026-12-31'), 1_000, null, contractId)),
      ).toEqual([due.id, later.id].sort());
      expect(await run(() => charges.findDueIds(day('2026-12-31'), 1_000, null, uuidv7()))).toEqual(
        [],
      );
      expect(await run(() => charges.findUnsettledIds(1_000, null, contractId))).toEqual(
        [due.id, later.id, collecting.id, failed.id].sort(),
      );
      const page = await run(() => charges.findUnsettledIds(1, null));
      const next = await run(() => charges.findUnsettledIds(1, page[0] ?? null));
      expect(next[0]! > page[0]!).toBe(true);
      await run(async () => {
        for (const charge of await charges.findOpen(contractId)) {
          charge.cancel(NOW);
          await charges.save(charge);
        }
      });
      expect(await run(() => charges.findOpen(contractId))).toEqual([]);
    });

    it('should tell whether other charges keep a contract in arrears', async () => {
      const { charges, run } = await create();
      const contractId = uuidv7();
      const inArrears = aCharge({ contractId, reference: 'installment:1' });
      inArrears.applyDunning(day('2026-12-12'), NOW);
      const current = aCharge({ contractId, reference: 'installment:2' });
      await run(async () => {
        await charges.save(inArrears);
        await charges.save(current);
      });

      expect(await run(() => charges.hasOtherChargesInArrears(contractId, current.id))).toBe(true);
      expect(await run(() => charges.hasOtherChargesInArrears(contractId, inArrears.id))).toBe(
        false,
      );
    });

    // Instalment 1 falls due on 12 November: it is written off 90 days later, on 10 February.
    it('should tell whether a contract defaults by a day, as billing sees it', async () => {
      const { charges, run } = await create();
      const [owing, writtenOff, current] = [uuidv7(), uuidv7(), uuidv7()];
      const lost = aCharge({ contractId: writtenOff });
      lost.applyDunning(day('2027-02-10'), NOW);
      await run(async () => {
        await charges.save(aCharge({ contractId: owing }));
        await charges.save(lost);
        await charges.save(aCharge({ contractId: current, dueDate: '2027-01-12' }));
      });

      expect(await run(() => charges.defaultsBy(owing, day('2027-02-09')))).toBe(false);
      expect(await run(() => charges.defaultsBy(owing, day('2027-02-10')))).toBe(true);
      expect(await run(() => charges.defaultsBy(writtenOff, day('2026-11-01')))).toBe(true);
      expect(await run(() => charges.defaultsBy(current, day('2027-02-10')))).toBe(false);
    });

    it('should tell whether a payoff of the contract is scheduled, being collected or paid', async () => {
      const { charges, run } = await create();
      const [payingOff, refusedPayoff, paidOff] = [uuidv7(), uuidv7(), uuidv7()];
      const payoff = aCharge({ contractId: payingOff, kind: 'payoff', reference: 'payoff:1' });
      payoff.submitCollection(uuidv7(), NOW);
      const paid = aCharge({ contractId: paidOff, kind: 'payoff', reference: 'payoff:3' });
      paid.recordSucceeded(paid.submitCollection(uuidv7(), NOW), NOW, false);
      const overdue = aCharge({ contractId: paidOff, reference: 'installment:2' });
      overdue.applyDunning(day('2026-11-13'), NOW);
      const refused = aCharge({ contractId: refusedPayoff, kind: 'payoff', reference: 'payoff:2' });
      refused.recordFailed(
        refused.submitCollection(uuidv7(), NOW),
        'refused',
        day('2026-11-12'),
        NOW,
      );
      await run(async () => {
        await charges.save(payoff);
        await charges.save(refused);
        await charges.save(aCharge({ contractId: refusedPayoff }));
        await charges.save(paid);
        await charges.save(overdue);
      });

      expect(await run(() => charges.hasPayoff(payingOff))).toBe(true);
      expect(await run(() => charges.hasPayoff(paidOff))).toBe(true);
      expect(await run(() => charges.hasPayoff(refusedPayoff))).toBe(false);
      expect((await run(() => charges.findOpen(paidOff))).map((charge) => charge.id)).toEqual([
        overdue.id,
      ]);
      await run(() => charges.lockContract(payingOff));
    });

    it('should refuse a second mandate in force for a contract', async () => {
      const { mandates, run } = await create();
      const first = aMandate();
      await run(() => mandates.save(first));

      await expect(
        run(() => mandates.save(aMandate({ contractId: first.contractId }))),
      ).rejects.toMatchObject({ code: 'concurrent_modification' });
    });

    it('should store mandates and find the one in force', async () => {
      const { mandates, run } = await create();
      const old = aMandate();
      old.revoke(LATER);
      const current = aMandate({ contractId: old.contractId });
      await run(async () => {
        await mandates.save(old);
        await mandates.save(current);
      });

      const found = await run(() => mandates.findActiveByContract(old.contractId));
      expect(found).toMatchObject({
        id: current.id,
        status: 'active',
        reference: current.reference,
      });
      expect(found?.iban.value).toBe(current.iban.value);
      expect((await run(() => mandates.findById(old.id)))?.status).toBe('revoked');
    });

    it('should store one income declaration per contract and month', async () => {
      const { declarations, run } = await create();
      const declaration = aDeclaration({ period: '2026-10', incomeCents: 2_345_67 });
      await run(() => declarations.save(declaration));

      const found = await run(() => declarations.findByPeriod(declaration.contractId, '2026-10'));
      expect(found?.grossMonthlyIncome.cents).toBe(2_345_67);
      expect(
        await run(() => declarations.findByPeriod(declaration.contractId, '2026-09')),
      ).toBeNull();
      await expect(
        run(() =>
          declarations.save(
            aDeclaration({ contractId: declaration.contractId, period: '2026-10' }),
          ),
        ),
      ).rejects.toMatchObject({ code: 'income_already_declared' });
    });

    it('should list the charges of a contract newest first, a page at a time', async () => {
      const { charges, queries, run } = await create();
      const contractId = uuidv7();
      const created = [1, 2, 3].map((number) =>
        aCharge({
          contractId,
          reference: `installment:${String(number)}`,
          installmentNumber: number,
        }),
      );
      await run(async () => {
        for (const charge of created) await charges.save(charge);
      });

      const first = await run(() => queries.listCharges(contractId, { limit: 2 }));

      expect(first.data).toHaveLength(2);
      expect(first.data[0]).toMatchObject({ contractId, kind: 'installment', status: 'scheduled' });
    });
  });
}
