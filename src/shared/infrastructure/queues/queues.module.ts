import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config';

import { DeadLetterQueue } from './dead-letter.queue';
import { ALL_QUEUES } from './queue-names';
import { bullConnection } from './redis-connection';

const DAY_SECONDS = 24 * 60 * 60;

// Producer side, shared by api and worker. Processors are registered only by the worker.
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        prefix: 'tramo',
        connection: bullConnection(config.redis.url),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: 'exponential', delay: 2_000 },
          // Completed jobs stay a week so a redelivered jobId is still recognised as a duplicate
          // and support can inspect recent runs; failures stay a month.
          removeOnComplete: { age: 7 * DAY_SECONDS, count: 10_000 },
          removeOnFail: { age: 30 * DAY_SECONDS },
        },
      }),
    }),
    BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name }))),
  ],
  providers: [DeadLetterQueue],
  exports: [BullModule, DeadLetterQueue],
})
export class QueuesModule {}
