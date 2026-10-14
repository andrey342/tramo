import { getQueueToken } from '@nestjs/bullmq';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type Queue } from 'bullmq';

import { ALL_QUEUES } from './queue-names';

// How often a queue that keeps failing to reach Redis says so.
const QUIET_MS = 60_000;

// A queue's connection reports every failed reconnect while Redis is down; without a listener
// BullMQ prints each one as a raw stack trace outside the logger. Each queue logs it at most once a
// minute instead; readiness reports the outage.
@Injectable()
export class QueueErrorLogger implements OnModuleInit {
  private readonly logger = new Logger('Queues');

  constructor(private readonly modules: ModuleRef) {}

  onModuleInit(): void {
    for (const name of ALL_QUEUES) {
      const queue = this.modules.get<Queue>(getQueueToken(name), { strict: false });
      let loggedAt = Number.NEGATIVE_INFINITY;
      queue.on('error', (error: Error) => {
        const now = Date.now();
        if (now - loggedAt >= QUIET_MS) {
          loggedAt = now;
          this.logger.warn({ queue: name, err: error.message }, 'Queue cannot reach Redis');
        }
      });
    }
  }
}
