import { uuidv7 } from 'uuidv7';

import { type ReportingStore } from '../../src/modules/reporting/application/ports/reporting-ports';
import { NOW, TODAY } from '../factories/reporting';

export interface ReportingStoreHarness {
  readonly store: ReportingStore;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

const at = (seconds: number): Date => new Date(NOW.getTime() + seconds * 1000);

// The in-memory store of the unit tests and the SQL one agree on how facts merge and on the
// figures read from them. Every test works on centers and programs of its own.
export function reportingStoreContract(
  name: string,
  create: () => Promise<ReportingStoreHarness> | ReportingStoreHarness,
): void {
  describe(`${name} (ReportingStore contract)`, () => {
    // ApplicationApproved (t=2) arrives before ApplicationSubmitted (t=1): the approval stays, and
    // the submission still adds what it knows.
    it('should keep the status of the latest event, and every field any event gave', async () => {
      const { store, run } = await create();
      const [centerId, programId, applicationId] = [uuidv7(), uuidv7(), uuidv7()];

      await run(async () => {
        await store.recordApplication({
          applicationId,
          at: at(2),
          eventId: uuidv7(),
          centerId,
          status: 'approved',
          decision: 'approved',
        });
        await store.recordApplication({
          applicationId,
          at: at(1),
          eventId: uuidv7(),
          centerId,
          programId,
          amountCents: 7_500_00,
          status: 'submitted',
        });
      });

      const figures = await run(() => store.centerFigures(centerId));
      const program = await run(() => store.programFigures(programId));
      expect(figures.applications).toMatchObject({ approved: 1, submitted: 0 });
      expect(program).toEqual({
        applications: 1,
        approved: 1,
        rejected: 0,
        amountCents: 7_500_00,
        pricedApplications: 1,
      });
    });

    it('should break a tie between two events of the same instant by the later event id', async () => {
      const { store, run } = await create();
      const [centerId, contractId, chargeId] = [uuidv7(), uuidv7(), uuidv7()];
      const [first, second] = [uuidv7(), uuidv7()];

      await run(async () => {
        await store.recordContract({
          contractId,
          at: at(0),
          eventId: uuidv7(),
          centerId,
          status: 'active',
        });
        await store.recordCharge({
          chargeId,
          at: at(5),
          eventId: second,
          contractId,
          status: 'cancelled',
        });
        await store.recordCharge({
          chargeId,
          at: at(5),
          eventId: first,
          contractId,
          centerId,
          amountCents: 6_000_00,
          status: 'failed',
          failedOn: TODAY,
        });
      });

      const figures = await run(() => store.centerFigures(centerId));
      expect(figures).toMatchObject({ outstandingCents: 0, collectedCents: 0 });
    });

    it('should sum the money of a center, in total and by product', async () => {
      const { store, run } = await create();
      const centerId = uuidv7();
      const [loan, isa] = [uuidv7(), uuidv7()];
      await run(async () => {
        await store.recordContract({
          contractId: loan,
          at: at(0),
          eventId: uuidv7(),
          centerId,
          product: 'installments',
          principalCents: 7_500_00,
          status: 'active',
        });
        await store.recordContract({
          contractId: isa,
          at: at(0),
          eventId: uuidv7(),
          centerId,
          product: 'isa',
          principalCents: 9_900_00,
          status: 'in_arrears',
        });
        await store.recordDisbursement({
          disbursementId: uuidv7(),
          at: at(1),
          eventId: uuidv7(),
          contractId: loan,
          centerId,
          amountCents: 7_125_00,
          status: 'settled',
        });
        await store.recordDisbursement({
          disbursementId: uuidv7(),
          at: at(1),
          eventId: uuidv7(),
          contractId: isa,
          centerId,
          amountCents: 9_405_00,
          status: 'pending',
        });
        await store.recordCharge({
          chargeId: uuidv7(),
          at: at(2),
          eventId: uuidv7(),
          contractId: loan,
          centerId,
          amountCents: 337_50,
          status: 'paid',
        });
        // A failure says nothing of the center: placed by its contract.
        await store.recordCharge({
          chargeId: uuidv7(),
          at: at(2),
          eventId: uuidv7(),
          contractId: isa,
          amountCents: 200_00,
          status: 'overdue',
        });
        await store.recordCharge({
          chargeId: uuidv7(),
          at: at(2),
          eventId: uuidv7(),
          contractId: loan,
          centerId,
          amountCents: 100_00,
          status: 'written_off',
        });
      });

      const figures = await run(() => store.centerFigures(centerId));

      expect(figures).toMatchObject({
        contracts: { active: 1, inArrears: 1, completed: 0, defaulted: 0, cancelled: 0 },
        disbursedCents: 7_125_00,
        collectedCents: 337_50,
        outstandingCents: 200_00,
        writtenOffCents: 100_00,
      });
      expect(figures.byProduct).toEqual([
        {
          product: 'installments',
          contracts: { active: 1, inArrears: 0, completed: 0, defaulted: 0, cancelled: 0 },
          disbursedCents: 7_125_00,
          collectedCents: 337_50,
          outstandingCents: 0,
          writtenOffCents: 100_00,
        },
        {
          product: 'isa',
          contracts: { active: 0, inArrears: 1, completed: 0, defaulted: 0, cancelled: 0 },
          disbursedCents: 0,
          collectedCents: 0,
          outstandingCents: 200_00,
          writtenOffCents: 0,
        },
      ]);
    });

    it('should count what operations look at, across centers', async () => {
      const { store, run } = await create();
      const before = await run(() => store.opsFigures(TODAY));
      await run(async () => {
        await store.recordApplication({
          applicationId: uuidv7(),
          at: at(0),
          eventId: uuidv7(),
          status: 'needs_review',
        });
        await store.recordCharge({
          chargeId: uuidv7(),
          at: at(0),
          eventId: uuidv7(),
          status: 'failed',
          failedOn: TODAY,
        });
        await store.recordCharge({
          chargeId: uuidv7(),
          at: at(0),
          eventId: uuidv7(),
          status: 'failed',
          failedOn: '2026-11-11',
        });
        await store.recordDisbursement({
          disbursementId: uuidv7(),
          at: at(0),
          eventId: uuidv7(),
          status: 'sent',
        });
        await store.recordDisbursement({
          disbursementId: uuidv7(),
          at: at(0),
          eventId: uuidv7(),
          status: 'failed',
        });
        await store.recordContract({
          contractId: uuidv7(),
          at: at(0),
          eventId: uuidv7(),
          status: 'in_arrears',
        });
      });

      const after = await run(() => store.opsFigures(TODAY));

      expect(after).toEqual({
        reviewQueue: before.reviewQueue + 1,
        failedChargesToday: before.failedChargesToday + 1,
        pendingDisbursements: before.pendingDisbursements + 1,
        failedDisbursements: before.failedDisbursements + 1,
        contractsInArrears: before.contractsInArrears + 1,
      });
    });

    it('should answer nothing for a center or program without facts', async () => {
      const { store, run } = await create();

      const figures = await run(() => store.centerFigures(uuidv7()));
      const program = await run(() => store.programFigures(uuidv7()));

      expect(figures).toMatchObject({
        disbursedCents: 0,
        collectedCents: 0,
        contracts: { active: 0 },
      });
      expect(program).toEqual({
        applications: 0,
        approved: 0,
        rejected: 0,
        amountCents: 0,
        pricedApplications: 0,
      });
    });
  });
}
