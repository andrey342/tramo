import { type BankTransferProvider } from '../../src/modules/lending/application/ports/lending-ports';
import { Money } from '../../src/shared/domain';

export interface BankTransferHarness {
  readonly provider: BankTransferProvider;
  // An account that takes payments, and one the bank bounces transfers from.
  readonly openIban: string;
  readonly closedIban: string;
}

const transferTo = (iban: string, idempotencyKey: string) => ({
  idempotencyKey,
  amount: Money.fromCents(7_125_00),
  creditorIban: iban,
  creditorName: 'Codeworks Madrid',
  reference: 'Tramo disbursement',
});

// Every implementation of BankTransferProvider (the fake used by unit tests and each real adapter)
// runs this suite, so the fake cannot drift from production behaviour.
export function bankTransferProviderContract(
  name: string,
  create: () => Promise<BankTransferHarness> | BankTransferHarness,
): void {
  describe(`${name} (BankTransferProvider contract)`, () => {
    let harness: BankTransferHarness;

    beforeEach(async () => {
      harness = await create();
    });

    it('should accept a transfer once per idempotency key', async () => {
      const { provider, openIban } = harness;

      const first = await provider.transfer(transferTo(openIban, 'disbursement-1.1'));
      const repeated = await provider.transfer(transferTo(openIban, 'disbursement-1.1'));
      const retried = await provider.transfer(transferTo(openIban, 'disbursement-1.2'));

      expect(repeated.transferId).toBe(first.transferId);
      expect(retried.transferId).not.toBe(first.transferId);
    });

    it('should settle a transfer to an open account, or report it pending', async () => {
      const { provider, openIban } = harness;
      const { transferId } = await provider.transfer(transferTo(openIban, 'disbursement-2.1'));

      expect(['settled', 'pending']).toContain((await provider.status(transferId)).state);
    });

    it('should report a transfer to a closed account as failed, with a reason', async () => {
      const { provider, closedIban } = harness;
      const { transferId } = await provider.transfer(transferTo(closedIban, 'disbursement-3.1'));

      expect(await provider.status(transferId)).toEqual({
        state: 'failed',
        reason: 'account_closed',
      });
    });

    it('should refuse the status of a transfer it never made', async () => {
      await expect(harness.provider.status('unknown-transfer')).rejects.toThrow();
    });
  });
}
