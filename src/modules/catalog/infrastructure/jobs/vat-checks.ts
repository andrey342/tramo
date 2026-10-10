import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Job, type JobsOptions, type Queue } from 'bullmq';

import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { VerifyCenterVatCommand } from '../../application/commands/verify-center-vat.command';

export interface VatCheckJob extends CorrelatedJobData {
  readonly centerId: string;
}

// VIES outages, or one member state's, last from minutes to hours. Exponential from one minute,
// twelve attempts keep asking for about a day and a half (1 + 2 + 4 + ... + 1024 minutes) before
// the job is dead-lettered for ops.
export const VAT_CHECK_JOB_OPTIONS: JobsOptions = {
  attempts: 12,
  backoff: { type: 'exponential', delay: 60_000 },
};

export class VatRegistryUnavailableError extends Error {
  constructor(centerId: string) {
    super(`VIES could not check the VAT number of center ${centerId}; retrying later.`);
    this.name = 'VatRegistryUnavailableError';
  }
}

@Injectable()
export class VatCheckScheduler {
  constructor(@InjectQueue(QueueNames.VAT_CHECKS) private readonly queue: Queue<VatCheckJob>) {}

  // One job per center: a redelivered CenterRegistered event does not queue a second check.
  async schedule(centerId: string, correlationId: string | null): Promise<void> {
    await this.queue.add(
      'verify-center-vat',
      { centerId, correlationId },
      { ...VAT_CHECK_JOB_OPTIONS, jobId: centerId },
    );
  }
}

// Runs outside any transaction: VerifyCenterVatCommand asks VIES first and then saves the answer
// in a short transaction of its own, so no connection waits on the registry, and the
// "unverified" mark stays visible while the job waits for its next attempt.
@Processor(QueueNames.VAT_CHECKS, { concurrency: 5 })
export class VatCheckProcessor extends QueueProcessor<VatCheckJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<VatCheckJob>): Promise<void> {
    const center = await this.commands.execute(
      new VerifyCenterVatCommand('system', job.data.centerId),
    );
    if (center.vatValidation?.status === 'unverified') {
      throw new VatRegistryUnavailableError(job.data.centerId);
    }
  }
}
