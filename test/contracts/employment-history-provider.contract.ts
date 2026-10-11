import { type EmploymentHistoryProvider } from '../../src/modules/origination/application/ports/origination-ports';
import { NationalId, unwrap } from '../../src/shared/domain';

const IDS = ['12345678Z', '00000000T', '87654321X', 'X1234567L'].map((value) =>
  unwrap(NationalId.create(value)),
);

export function employmentHistoryProviderContract(
  name: string,
  create: () => Promise<EmploymentHistoryProvider> | EmploymentHistoryProvider,
): void {
  describe(`${name} (EmploymentHistoryProvider contract)`, () => {
    let subject: EmploymentHistoryProvider;

    beforeEach(async () => {
      subject = await create();
    });

    it('should answer the same for the same id, within the ranges of a two-year record', async () => {
      for (const nationalId of IDS) {
        const first = await subject.fetch(nationalId);

        expect(await subject.fetch(nationalId)).toEqual(first);
        expect(Number.isInteger(first.monthsWorkedLast24)).toBe(true);
        expect(first.monthsWorkedLast24).toBeGreaterThanOrEqual(0);
        expect(first.monthsWorkedLast24).toBeLessThanOrEqual(24);
        // An income only while employed.
        expect(first.currentMonthlyIncome !== null).toBe(first.currentlyEmployed);
      }
    });
  });
}
