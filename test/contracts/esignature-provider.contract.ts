import { createHash } from 'node:crypto';

import { type ESignatureProvider } from '../../src/modules/lending/application/ports/lending-ports';

const request = (contractId: string) => {
  const document = `Contract ${contractId}`;
  return {
    contractId,
    studentId: '0199a000-0000-7000-8000-000000000001',
    document,
    documentHash: createHash('sha256').update(document).digest('hex'),
  };
};

// Every implementation of ESignatureProvider (the fake used by unit tests and each real adapter)
// runs this suite, so the fake cannot drift from production behaviour.
export function esignatureProviderContract(
  name: string,
  create: () => Promise<ESignatureProvider> | ESignatureProvider,
): void {
  describe(`${name} (ESignatureProvider contract)`, () => {
    let subject: ESignatureProvider;

    beforeEach(async () => {
      subject = await create();
    });

    it('should name itself, for the signature record', () => {
      expect(subject.name).toEqual(expect.any(String));
      expect(subject.name.length).toBeGreaterThan(0);
    });

    it('should give the same envelope when one contract is sent twice', async () => {
      const first = await subject.sendEnvelope(request('0199a000-0000-7000-8000-00000000000a'));
      const again = await subject.sendEnvelope(request('0199a000-0000-7000-8000-00000000000a'));

      expect(first.envelopeId.length).toBeGreaterThan(0);
      expect(again.envelopeId).toBe(first.envelopeId);
    });

    it('should give different envelopes to different contracts', async () => {
      const one = await subject.sendEnvelope(request('0199a000-0000-7000-8000-00000000000b'));
      const other = await subject.sendEnvelope(request('0199a000-0000-7000-8000-00000000000c'));

      expect(other.envelopeId).not.toBe(one.envelopeId);
    });
  });
}
