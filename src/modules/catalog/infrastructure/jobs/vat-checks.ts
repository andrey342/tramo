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

  // One job per center and cause: a redelivered event does not queue a second check. The check
  // on registration is `<centerId>`; a later one (a corrected number, a reinstated center) is
  // `<centerId>.<eventId>`, since BullMQ ignores an id it still holds, completed jobs included.
  async schedule(
    centerId: string,
    correlationId: string | null,
    causeEventId?: string,
  ): Promise<void> {
    await this.queue.add(
      'verify-center-vat',
      { centerId, correlationId },
      {
        ...VAT_CHECK_JOB_OPTIONS,
        jobId: causeEventId === undefined ? centerId : `${centerId}.${causeEventId}`,
      },
    );
  }
}

// Runs outside any transaction: VerifyCenterVatCommand asks VIES first and then saves the answer
// in a short transaction of its own, so no connection waits on the registry, and the
// "unverified" mark stays visible while the job waits for its next attempt. The retry follows
// the registry's answer, not the status the center keeps: an outage leaves an earlier `invalid`
// verdict in place (a reinstated center whose number was refused once), and that check must still
// be asked again until VIES answers.
@Processor(QueueNames.VAT_CHECKS, { concurrency: 5 })
export class VatCheckProcessor extends QueueProcessor<VatCheckJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<VatCheckJob>): Promise<void> {
    const { outcome } = await this.commands.execute(
      new VerifyCenterVatCommand('system', job.data.centerId),
    );
    if (outcome === 'unavailable') {
      throw new VatRegistryUnavailableError(job.data.centerId);
    }
  }
}
