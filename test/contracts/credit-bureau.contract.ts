import { type CreditBureau } from '../../src/modules/origination/application/ports/origination-ports';
import { NationalId, unwrap } from '../../src/shared/domain';

const id = (value: string) => unwrap(NationalId.create(value));

export function creditBureauContract(
  name: string,
  create: () => Promise<CreditBureau> | CreditBureau,
): void {
  describe(`${name} (CreditBureau contract)`, () => {
    let subject: CreditBureau;

    beforeEach(async () => {
      subject = await create();
    });

    it('should list a national id ending in 7 in a default registry, with a low score', async () => {
      // 12345677 mod 23 = 13, letter J.
      const result = await subject.check(id('12345677J'));

      expect(result.listedInDefaultRegistry).toBe(true);
      expect(result.score).toBeLessThan(500);
    });

    it('should score anybody else from 0 to 1000, the same every time', async () => {
      const result = await subject.check(id('12345678Z'));

      expect(result.listedInDefaultRegistry).toBe(false);
      expect(result.score).toBeGreaterThanOrEqual(500);
      expect(result.score).toBeLessThanOrEqual(1_000);
      expect(await subject.check(id('12345678Z'))).toEqual(result);
    });
  });
}
