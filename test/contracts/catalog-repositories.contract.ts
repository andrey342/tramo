import {
  CenterAlreadyRegisteredError,
  FinancingOptions,
  type ProgramRepository,
  type TrainingCenterRepository,
} from '../../src/modules/catalog/domain';
import { Iban, unwrap } from '../../src/shared/domain';
import {
  anActiveTrainingCenter,
  aProgram,
  aTaxId,
  aTrainingCenter,
  installments,
  isa,
  NOW,
  OTHER_IBAN,
} from '../factories/catalog';

export interface CatalogRepositoriesHarness {
  readonly centers: TrainingCenterRepository;
  readonly programs: ProgramRepository;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

// The in-memory repository used by handler tests and the TypeORM one must answer the same.
export function catalogRepositoriesContract(
  name: string,
  create: () => Promise<CatalogRepositoriesHarness> | CatalogRepositoriesHarness,
): void {
  describe(`${name} (catalog repositories contract)`, () => {
    let t: CatalogRepositoriesHarness;

    beforeEach(async () => {
      t = await create();
    });

    it('should find a center by id and by VAT number, with every field intact', async () => {
      const center = aTrainingCenter();
      center.recordVatCheck({ outcome: 'valid', provider: 'vies', registeredName: 'CW SL' }, NOW);
      await t.run(() => t.centers.save(center));

      const byId = await t.centers.findById(center.id);
      const byVat = await t.centers.findByVatNumber(center.vatNumber);

      expect(byVat?.id).toBe(center.id);
      expect(byId?.status).toBe('active');
      expect(byId?.vatValidation).toEqual({
        status: 'valid',
        checkedAt: NOW,
        provider: 'vies',
        registeredName: 'CW SL',
      });
      expect(byId?.payoutIban.equals(center.payoutIban)).toBe(true);
      expect(byId?.platformFee.basisPoints).toBe(500);
      expect(byId?.version).toBe(1);
    });

    it('should refuse a second center with the same VAT number', async () => {
      const taxId = aTaxId();
      await t.run(() => t.centers.save(aTrainingCenter({ taxId })));

      await expect(t.run(() => t.centers.save(aTrainingCenter({ taxId })))).rejects.toThrow(
        CenterAlreadyRegisteredError,
      );
    });

    it('should store a changed payout account', async () => {
      const center = aTrainingCenter();
      await t.run(() => t.centers.save(center));
      const loaded = await t.centers.findById(center.id);
      loaded?.changePayoutIban(unwrap(Iban.create(OTHER_IBAN)), NOW);
      await t.run(() => t.centers.save(loaded!));

      const reloaded = await t.centers.findById(center.id);
      expect(reloaded?.payoutIban.value).toBe(OTHER_IBAN);
      expect(reloaded?.version).toBe(2);
    });

    it('should answer null for unknown ids', async () => {
      expect(await t.centers.findById('0199a000-0000-7000-8000-0000000000ff')).toBeNull();
      expect(await t.programs.findById('0199a000-0000-7000-8000-0000000000ff')).toBeNull();
    });

    it('should store a program with both financing options and read it back equal', async () => {
      const center = anActiveTrainingCenter();
      await t.run(() => t.centers.save(center));
      const program = aProgram({
        centerId: center.id,
        financing: FinancingOptions.of({ installments: installments([24, 12]), isa: isa() }),
      });
      program.publish(center, NOW);
      await t.run(() => t.programs.save(program));

      const loaded = await t.programs.findById(program.id);

      expect(loaded?.status).toBe('published');
      expect(loaded?.publishedAt).toEqual(NOW);
      expect(loaded?.financing.equals(program.financing)).toBe(true);
      expect(loaded?.details.startDates).toEqual(['2027-01-11', '2027-04-05']);
      expect(loaded?.details.price.cents).toBe(750_000);
      expect(loaded?.version).toBe(1);
    });

    it('should store a program without financing options', async () => {
      const center = anActiveTrainingCenter();
      await t.run(() => t.centers.save(center));
      const program = aProgram({ centerId: center.id, financing: FinancingOptions.none() });
      await t.run(() => t.programs.save(program));

      expect((await t.programs.findById(program.id))?.financing.isEmpty).toBe(true);
    });
  });
}
