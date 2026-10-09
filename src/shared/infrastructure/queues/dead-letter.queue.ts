import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { type Job, Queue } from 'bullmq';

import { QueueNames } from './queue-names';

export interface DeadLetter {
  readonly queue: string;
  readonly jobId: string | undefined;
  readonly jobName: string;
  readonly data: unknown;
  readonly failedReason: string;
  readonly attemptsMade: number;
  readonly failedAt: string;
}

// BullMQ keeps exhausted jobs in the source queue's failed set, where they expire. Copying them to
// a dedicated queue gives operations one place to look, alert on and redeliver from.
@Injectable()
export class DeadLetterQueue {
  private readonly logger = new Logger(DeadLetterQueue.name);

  constructor(@InjectQueue(QueueNames.DEAD_LETTER) private readonly queue: Queue) {}

  async bury(job: Job, error: Error, now: Date): Promise<void> {
    const letter: DeadLetter = {
      queue: job.queueName,
      jobId: job.id,
      jobName: job.name,
      data: job.data,
      failedReason: error.message,
      attemptsMade: job.attemptsMade,
      failedAt: now.toISOString(),
    };
    // Same id as the source job, so a burial reported twice is stored once. Dead letters are
    // kept until someone removes them.
    await this.queue.add(job.name, letter, {
      jobId: `${job.queueName}.${job.id ?? job.name}`,
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false,
    });
    this.logger.error(
      { queue: job.queueName, jobId: job.id, jobName: job.name, failedReason: error.message },
      'Job moved to dead-letter queue',
    );
  }
}
