import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { type Job, type Queue } from 'bullmq';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { signWebhook } from '@shared/infrastructure/http';
import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { type PspCallbackScheduler, type SimulatedPspCallback } from './simulated-payment-gateway';

export const PSP_SIGNATURE_HEADER = 'x-psp-signature';

// The simulated provider's "later": its answer waits on a queue, then is posted to the api like a
// real provider's callback. Keyed by the collection, so one request gets one answer (and one
// return). A return waits twice as long, so it comes after the success; one that arrives first is
// refused (409) and retried.
@Injectable()
export class QueuedPspCallbacks implements PspCallbackScheduler {
  constructor(
    @InjectQueue(QueueNames.PSP_SIMULATOR) private readonly queue: Queue<SimulatedPspCallback>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async schedule(callback: SimulatedPspCallback): Promise<void> {
    const returned = callback.outcome === 'returned';
    await this.queue.add('payment.callback', callback, {
      jobId: `${callback.reference}.${returned ? 'return' : 'callback'}`,
      delay: this.config.billing.simulatedPspDelayMs * (returned ? 2 : 1),
      attempts: 8,
      backoff: { type: 'exponential', delay: 2_000 },
    });
  }
}

type CallbackJob = SimulatedPspCallback & CorrelatedJobData;

// Posts the signed callback to POST /webhooks/psp; a refusal or an api that is down is retried.
@Processor(QueueNames.PSP_SIMULATOR)
export class SimulatedPspCallbackProcessor extends QueueProcessor<CallbackJob> {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  protected async handle(job: Job<CallbackJob>): Promise<number> {
    const { reference, paymentId, outcome, failureReason } = job.data;
    const reason =
      outcome === 'returned'
        ? { returnReason: failureReason }
        : failureReason
          ? { failureReason }
          : {};
    const body = JSON.stringify({
      eventId: `${paymentId}.${outcome}`,
      type: `payment.${outcome}`,
      paymentId,
      reference,
      ...reason,
      occurredAt: this.clock.now().toISOString(),
    });
    const [secret] = this.config.billing.pspWebhookSecrets;
    const response = await fetch(`${this.config.billing.pspCallbackUrl}/api/v1/webhooks/psp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [PSP_SIGNATURE_HEADER]: signWebhook(secret ?? '', body, this.clock.now()),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`The api answered ${String(response.status)} to the PSP callback.`);
    }
    return response.status;
  }
}
