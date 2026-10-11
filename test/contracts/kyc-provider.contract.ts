import { type KycProvider } from '../../src/modules/origination/application/ports/origination-ports';
import { NationalId, unwrap } from '../../src/shared/domain';

const id = (value: string) => unwrap(NationalId.create(value));

// The simulated provider every environment runs and the fake of unit tests agree on the scenarios
// demos and tests rely on.
export function kycProviderContract(
  name: string,
  create: () => Promise<KycProvider> | KycProvider,
): void {
  describe(`${name} (KycProvider contract)`, () => {
    let subject: KycProvider;

    beforeEach(async () => {
      subject = await create();
    });

    it('should verify an identity and say how sure it is', async () => {
      const result = await subject.verifyIdentity({
        nationalId: id('12345678Z'),
        dateOfBirth: '1998-05-20',
      });

      expect(result).toMatchObject({ verified: true, reasons: [] });
      expect(result.confidence.basisPoints).toBeGreaterThanOrEqual(9_000);
    });

    it('should fail a national id ending in 9, with a reason', async () => {
      // 12345679 mod 23 = 15, letter S.
      const result = await subject.verifyIdentity({
        nationalId: id('12345679S'),
        dateOfBirth: '1998-05-20',
      });

      expect(result.verified).toBe(false);
      expect(result.reasons.length).toBeGreaterThan(0);
    });
  });
}
