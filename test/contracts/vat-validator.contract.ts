import { type VatValidator } from '../../src/modules/catalog/application/ports/catalog-ports';
import { unwrap, VatNumber } from '../../src/shared/domain';

// The numbers the VIES test service answers deterministically: 100 is valid, 200 is invalid and
// 300 simulates the service being down. The fake follows the same table, so every implementation
// runs one suite.
const vat = (number: string): VatNumber => unwrap(VatNumber.create('ES', number));

export function vatValidatorContract(
  name: string,
  create: () => Promise<VatValidator> | VatValidator,
): void {
  describe(`${name} (VatValidator contract)`, () => {
    let subject: VatValidator;

    beforeEach(async () => {
      subject = await create();
    });

    it('should answer valid for a registered number', async () => {
      expect(await subject.check(vat('100'))).toMatchObject({ outcome: 'valid' });
    });

    it('should answer invalid for a number the registry does not know', async () => {
      expect(await subject.check(vat('200'))).toMatchObject({ outcome: 'invalid' });
    });

    it('should answer unavailable, not throw, when the registry is down', async () => {
      const result = await subject.check(vat('300'));

      expect(result).toMatchObject({
        outcome: 'unavailable',
        reason: expect.any(String) as string,
      });
    });

    it('should name the provider that answered', async () => {
      const result = await subject.check(vat('100'));

      expect(result.provider.length).toBeGreaterThan(0);
    });
  });
}
