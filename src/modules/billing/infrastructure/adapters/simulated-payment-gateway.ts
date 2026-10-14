import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { type CollectionRequest, type PaymentGateway } from '../../application/ports/billing-ports';

// The answer the simulated provider sends later to POST /webhooks/psp. A return comes after the
// success it undoes.
export interface SimulatedPspCallback {
  readonly reference: string;
  readonly paymentId: string;
  readonly outcome: 'succeeded' | 'failed' | 'returned';
  // Why it failed, or the return reason code.
  readonly failureReason: string | null;
}

export const PSP_CALLBACK_SCHEDULER = Symbol('PSP_CALLBACK_SCHEDULER');

export interface PspCallbackScheduler {
  schedule(callback: SimulatedPspCallback): Promise<void>;
}

// Stands in for a payment service provider collecting SEPA direct debits: it accepts every
// request at once and answers a little later through the signed webhook, as a real one does. An
// amount ending in 13 cents is refused for insufficient funds, which is how the demo shows
// dunning; one ending in 14 cents is collected and then returned by the student's bank (MD06, a
// refund the debtor asked for) on its first attempt, which shows a return, and collected for good
// when dunning tries again. Deterministic and stateless: the payment id
// derives from the idempotency key, so a repeated request gets the same payment (and the same
// answers, which the charge ignores).
@Injectable()
export class SimulatedPaymentGateway implements PaymentGateway {
  constructor(@Inject(PSP_CALLBACK_SCHEDULER) private readonly callbacks: PspCallbackScheduler) {}

  async collect(request: CollectionRequest): Promise<{ readonly paymentId: string }> {
    const paymentId = `sim-pay-${createHash('sha256').update(request.idempotencyKey).digest('hex').slice(0, 24)}`;
    const cents = request.amount.cents % 100;
    const refused = cents === 13;
    await this.callbacks.schedule({
      reference: request.idempotencyKey,
      paymentId,
      outcome: refused ? 'failed' : 'succeeded',
      failureReason: refused ? 'insufficient_funds' : null,
    });
    // The attempt number ends the key (`<chargeId>.<attempt>`).
    if (cents === 14 && request.idempotencyKey.endsWith('.1')) {
      await this.callbacks.schedule({
        reference: request.idempotencyKey,
        paymentId,
        outcome: 'returned',
        failureReason: 'MD06',
      });
    }
    return { paymentId };
  }
}
