import { type ProgramCatalog } from '../../src/modules/catalog/application/ports/catalog-ports';
import { toProgramDto } from '../../src/modules/catalog/application/program.mapping';
import {
  FinancingOptions,
  type Program,
  type ProgramRepository,
  type TrainingCenter,
  type TrainingCenterRepository,
} from '../../src/modules/catalog/domain';
import { Money } from '../../src/shared/domain';
import { anActiveTrainingCenter, aProgram, installments, isa, NOW } from '../factories/catalog';

export interface ProgramCatalogHarness {
  readonly catalog: ProgramCatalog;
  readonly centers: TrainingCenterRepository;
  readonly programs: ProgramRepository;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

// The SQL read model and the in-memory one answer the public catalog the same way. Every test
// filters by its own centers, so data left by other suites does not matter.
export function programCatalogContract(
  name: string,
  create: () => Promise<ProgramCatalogHarness> | ProgramCatalogHarness,
): void {
  describe(`${name} (ProgramCatalog contract)`, () => {
    let t: ProgramCatalogHarness;
    let open: TrainingCenter;
    let suspended: TrainingCenter;
    let bootcamp: Program;
    let dataCourse: Program;
    let draft: Program;
    let ofSuspendedCenter: Program;

    beforeEach(async () => {
      t = await create();
      open = anActiveTrainingCenter({ name: 'Open School' });
      suspended = anActiveTrainingCenter({ name: 'Suspended School' });
      bootcamp = aProgram({
        centerId: open.id,
        details: { name: 'Bootcamp', price: Money.fromCents(7_500_00) },
      });
      dataCourse = aProgram({
        centerId: open.id,
        details: { name: 'Data', modality: 'online', price: Money.fromCents(4_200_00) },
        financing: FinancingOptions.of({ installments: installments(), isa: isa() }),
      });
      draft = aProgram({ centerId: open.id, details: { name: 'Draft' } });
      ofSuspendedCenter = aProgram({ centerId: suspended.id });
      for (const program of [bootcamp, dataCourse]) program.publish(open, NOW);
      ofSuspendedCenter.publish(suspended, NOW);
      suspended.suspend('Audit', NOW);
      await t.run(async () => {
        for (const center of [open, suspended]) await t.centers.save(center);
        for (const program of [bootcamp, dataCourse, draft, ofSuspendedCenter])
          await t.programs.save(program);
      });
    });

    const ids = (page: { data: readonly { id: string }[] }): string[] =>
      page.data.map((item) => item.id);

    it('should list the published programs of active centers, newest first, with the center name', async () => {
      const page = await t.catalog.list({ centerId: open.id }, { limit: 10 });

      expect(ids(page)).toEqual([dataCourse.id, bootcamp.id]);
      expect(page.data[0]?.centerName).toBe('Open School');
      expect(page.nextCursor).toBeNull();
      expect(await t.catalog.list({ centerId: suspended.id }, { limit: 10 })).toEqual({
        data: [],
        nextCursor: null,
      });
    });

    it('should filter by product, modality and price range', async () => {
      expect(
        ids(await t.catalog.list({ centerId: open.id, product: 'isa' }, { limit: 10 })),
      ).toEqual([dataCourse.id]);
      expect(
        ids(await t.catalog.list({ centerId: open.id, modality: 'online' }, { limit: 10 })),
      ).toEqual([dataCourse.id]);
      expect(
        ids(
          await t.catalog.list(
            { centerId: open.id, minPriceCents: 5_000_00, maxPriceCents: 8_000_00 },
            { limit: 10 },
          ),
        ),
      ).toEqual([bootcamp.id]);
    });

    it('should walk the pages with the cursor', async () => {
      const first = await t.catalog.list({ centerId: open.id }, { limit: 1 });
      const second = await t.catalog.list(
        { centerId: open.id },
        { limit: 1, cursor: first.nextCursor ?? undefined },
      );

      expect(ids(first)).toEqual([dataCourse.id]);
      expect(ids(second)).toEqual([bootcamp.id]);
      expect(second.nextCursor).toBeNull();
    });

    it('should answer with what the program itself shows, plus its center name', async () => {
      expect(await t.catalog.findPublished(dataCourse.id)).toEqual({
        ...toProgramDto(dataCourse),
        centerName: 'Open School',
      });
    });

    it('should find a published program by id and nothing else', async () => {
      expect(
        (await t.catalog.findPublished(bootcamp.id))?.financing.installments?.allowedTerms,
      ).toEqual([12, 24]);
      expect(await t.catalog.findPublished(draft.id)).toBeNull();
      expect(await t.catalog.findPublished(ofSuspendedCenter.id)).toBeNull();
    });
  });
}
