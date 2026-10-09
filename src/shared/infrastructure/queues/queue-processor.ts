import { OnWorkerEvent, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';
import { CLS_ID, ClsService } from 'nestjs-cls';

import { CLOCK, type Clock } from '@shared/domain';

import { DeadLetterQueue } from './dead-letter.queue';

export interface CorrelatedJobData {
  readonly correlationId?: string | null;
}

// Base for every processor in the worker:
// - runs each job in its own CLS context whose id is the correlation id of the request that
//   caused it, so logs and outbox rows written by the job trace back to that request;
// - after the last attempt (or an UnrecoverableError) copies the job to the dead-letter queue.
export abstract class QueueProcessor<
  D extends CorrelatedJobData = CorrelatedJobData,
> extends WorkerHost {
  @Inject(ClsService) protected readonly cls!: ClsService;
  @Inject(DeadLetterQueue) private readonly deadLetters!: DeadLetterQueue;
  @Inject(CLOCK) protected readonly clock!: Clock;
  protected readonly logger = new Logger(this.constructor.name);

  protected abstract handle(job: Job<D>): Promise<unknown>;

  process(job: Job<D>): Promise<unknown> {
    return this.cls.run(() => {
      this.cls.set(CLS_ID, job.data.correlationId ?? `${job.queueName}.${job.id ?? job.name}`);
      return this.handle(job);
    });
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job<D> | undefined, error: Error): Promise<void> {
    if (!job) {
      return;
    }
    const exhausted =
      error instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    if (!exhausted) {
      this.logger.warn(
        { queue: job.queueName, jobId: job.id, attemptsMade: job.attemptsMade, err: error.message },
        'Job failed, will retry',
      );
      return;
    }
    // Runs inside an event listener: a rejection here would be unhandled and stop the worker.
    try {
      await this.deadLetters.bury(job, error, this.clock.now());
    } catch (buryError) {
      this.logger.error(
        { queue: job.queueName, jobId: job.id, err: buryError },
        'Could not move exhausted job to the dead-letter queue; it remains in the failed set',
      );
    }
  }
}
