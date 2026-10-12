import { type PaymentGateway } from '../../src/modules/billing/application/ports/billing-ports';
import { Money } from '../../src/shared/domain';

const request = (idempotencyKey: string) => ({
  idempotencyKey,
  amount: Money.fromCents(337_50),
  mandateReference: 'TRAMO-0123456789ABCDEF',
  debtorIban: 'ES7620770024003102575766',
  description: 'Tramo installment:1',
});

// Every implementation of PaymentGateway (the fake used by unit tests and each real adapter)
// runs this suite, so the fake cannot drift from production behaviour.
export function paymentGatewayContract(
  name: string,
  create: () => Promise<PaymentGateway> | PaymentGateway,
): void {
  describe(`${name} (PaymentGateway contract)`, () => {
    let gateway: PaymentGateway;

    beforeEach(async () => {
      gateway = await create();
    });

    it('should accept a collection once per idempotency key', async () => {
      const first = await gateway.collect(request('charge-1.1'));
      const repeated = await gateway.collect(request('charge-1.1'));
      const retried = await gateway.collect(request('charge-1.2'));

      expect(first.paymentId.length).toBeGreaterThan(0);
      expect(repeated.paymentId).toBe(first.paymentId);
      expect(retried.paymentId).not.toBe(first.paymentId);
    });
  });
}
