import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Job, type JobsOptions, type Queue } from 'bullmq';

import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { RunVerificationCommand } from '../../application/commands/run-verification.command';
import { type VerificationType } from '../../domain';

export interface VerificationJob extends CorrelatedJobData {
  readonly applicationId: string;
  readonly type: VerificationType;
}

// One job per provider, named as the providers' operations.
const JOB_NAMES: Readonly<Record<VerificationType, string>> = {
  kyc: 'kyc.verify',
  employment: 'employment.fetch',
  bureau: 'bureau.check',
};

// A provider outage is retried for about two hours (exponential from 30 s, eight attempts) before
// the job is dead-lettered; the application then waits, and expires if nobody intervenes.
export const VERIFICATION_JOB_OPTIONS: JobsOptions = {
  attempts: 8,
  backoff: { type: 'exponential', delay: 30_000 },
};

@Injectable()
export class VerificationJobs {
  constructor(
    @InjectQueue(QueueNames.VERIFICATIONS) private readonly queue: Queue<VerificationJob>,
  ) {}

  // The job id is the application and the provider: a redelivered ApplicationSubmitted queues
  // nothing new, and each provider is asked once per application.
  async queueAll(applicationId: string, correlationId: string | null): Promise<void> {
    await this.queue.addBulk(
      (Object.keys(JOB_NAMES) as VerificationType[]).map((type) => ({
        name: JOB_NAMES[type],
        data: { applicationId, type, correlationId },
        opts: { ...VERIFICATION_JOB_OPTIONS, jobId: `${applicationId}.${type}` },
      })),
    );
  }
}

// Asks the provider outside any transaction and records the answer in a short one
// (RunVerificationCommand); the three jobs of an application run in parallel.
@Processor(QueueNames.VERIFICATIONS, { concurrency: 10 })
export class VerificationProcessor extends QueueProcessor<VerificationJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<VerificationJob>): Promise<void> {
    await this.commands.execute(new RunVerificationCommand(job.data.applicationId, job.data.type));
  }
}
