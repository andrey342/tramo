import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Queue } from 'bullmq';

import { QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { ExpireApplicationCommand } from '../../application/commands/expire-application.command';
import {
  EXPIRY_DAYS,
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
const BATCH = 100;

// Registers the hourly sweep. Upserting by name is idempotent: every worker does it on start and
// there is still one schedule.
@Injectable()
export class ApplicationExpirySchedule implements OnApplicationBootstrap {
  constructor(@InjectQueue(QueueNames.APPLICATION_EXPIRY) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'expire-stale-applications',
      { every: SWEEP_EVERY_MS },
      { name: 'sweep', opts: { attempts: 1 } },
    );
  }
}

// Expires applications that have not moved for EXPIRY_DAYS, a batch at a time, each in its own
// transaction: one that moved meanwhile is left alone (ExpireApplicationCommand checks again).
@Processor(QueueNames.APPLICATION_EXPIRY)
export class ApplicationExpiryProcessor extends QueueProcessor {
  constructor(
    private readonly commands: CommandBus,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
  ) {
    super();
  }

  protected async handle(): Promise<number> {
    const before = new Date(this.clock.now().getTime() - EXPIRY_DAYS * DAY_MS);
    let expired = 0;
    for (;;) {
      const ids = await this.applications.findStaleIds(before, BATCH);
      let expiredNow = 0;
      for (const id of ids) {
        if (await this.commands.execute(new ExpireApplicationCommand(id))) {
          expiredNow += 1;
        }
      }
      expired += expiredNow;
      // A full batch of which none expired would come back unchanged: stop rather than spin.
      if (ids.length < BATCH || expiredNow === 0) {
        return expired;
      }
    }
  }
}
