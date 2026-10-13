import { type CommandBus } from '@nestjs/cqrs';
import { type Job } from 'bullmq';

import { type VatCheckOutcome } from '../../domain';

import { type VatCheckJob, VatCheckProcessor, VatRegistryUnavailableError } from './vat-checks';

// Only the decision to retry; the queue and the command are covered by vat-checks.int-spec.ts.
class ProcessorProbe extends VatCheckProcessor {
  run(job: Job<VatCheckJob>): Promise<void> {
    return this.handle(job);
  }
}

describe('VatCheckProcessor', () => {
  const job = { data: { centerId: 'center-1', correlationId: null } } as Job<VatCheckJob>;
  const answering = (outcome: VatCheckOutcome, vatStatus: string): ProcessorProbe =>
    new ProcessorProbe({
      execute: () =>
        Promise.resolve({
          outcome,
          center: { status: 'pending_verification', vatValidation: { status: vatStatus } },
        }),
    } as unknown as CommandBus);

  it('should retry when the registry could not answer even if the center keeps an invalid verdict', async () => {
    await expect(answering('unavailable', 'invalid').run(job)).rejects.toThrow(
      VatRegistryUnavailableError,
    );
  });

  it('should finish when the registry gave a verdict', async () => {
    await expect(answering('invalid', 'invalid').run(job)).resolves.toBeUndefined();
    await expect(answering('valid', 'valid').run(job)).resolves.toBeUndefined();
  });
});
