import { Money } from '@shared/domain';

import { paymentGatewayContract } from '../../../../../test/contracts/payment-gateway.contract';
import { FakePaymentGateway } from '../../../../../test/fakes/billing';

import { type SimulatedPspCallback, SimulatedPaymentGateway } from './simulated-payment-gateway';

paymentGatewayContract('FakePaymentGateway', () => new FakePaymentGateway());
paymentGatewayContract(
  'SimulatedPaymentGateway',
  () => new SimulatedPaymentGateway({ schedule: () => Promise.resolve() }),
);

describe('SimulatedPaymentGateway', () => {
  it('should answer later, refusing amounts that end in 13 cents and returning those in 14 once', async () => {
    const callbacks: SimulatedPspCallback[] = [];
    const gateway = new SimulatedPaymentGateway({
      schedule: (callback) => {
        callbacks.push(callback);
        return Promise.resolve();
      },
    });
    const collect = (key: string, cents: number) =>
      gateway.collect({
        idempotencyKey: key,
        amount: Money.fromCents(cents),
        mandateReference: 'TRAMO-0123456789ABCDEF',
        debtorIban: 'ES7620770024003102575766',
        description: 'Tramo',
      });

    const paid = await collect('charge-1.1', 337_50);
    await collect('charge-2.1', 337_13);
    const returned = await collect('charge-3.1', 337_14);
    const retried = await collect('charge-3.2', 337_14);

    expect(callbacks).toEqual([
      {
        reference: 'charge-1.1',
        paymentId: paid.paymentId,
        outcome: 'succeeded',
        failureReason: null,
      },
      {
        reference: 'charge-2.1',
        paymentId: expect.any(String),
        outcome: 'failed',
        failureReason: 'insufficient_funds',
      },
      {
        reference: 'charge-3.1',
        paymentId: returned.paymentId,
        outcome: 'succeeded',
        failureReason: null,
      },
      {
        reference: 'charge-3.1',
        paymentId: returned.paymentId,
        outcome: 'returned',
        failureReason: 'MD06',
      },
      {
        reference: 'charge-3.2',
        paymentId: retried.paymentId,
        outcome: 'succeeded',
        failureReason: null,
      },
    ]);
  });
});
