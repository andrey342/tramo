import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type Queue } from 'bullmq';

import { ALL_QUEUES } from './queue-names';
import { RedisErrorReporter } from './redis-errors';

// The producer side of every queue reports its errors through the logger (RedisErrorReporter);
// QueueProcessor does the same for the workers.
@Injectable()
export class QueueErrorLogger implements OnModuleInit {
  private readonly logger = new Logger('Queues');

  constructor(private readonly modules: ModuleRef) {}

  onModuleInit(): void {
    for (const name of ALL_QUEUES) {
      const queue = this.modules.get<Queue>(getQueueToken(name), { strict: false });
      const reporter = new RedisErrorReporter(this.logger, 'Queue', { queue: name });
      queue.on('error', (error: Error) => {
        reporter.report(error);
      });
    }
  }
}
