import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Queue } from 'bullmq';

import { QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import {
  PurgeEndedSessionsCommand,
  type PurgedSessionsDto,
} from '../../application/commands/purge-ended-sessions.command';

const SWEEP = 'sessions.sweep';

// Every day at 03:30 UTC, tokens of sessions that ended a month ago are deleted
// (PurgeEndedSessionsCommand). Upserted by name on every worker start: one schedule. A failed run
// is not retried; the next day's run deletes what it left.
@Injectable()
export class SessionSweepSchedule implements OnApplicationBootstrap {
  constructor(@InjectQueue(QueueNames.SESSION_SWEEP) private readonly queue: Queue) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      SWEEP,
      { pattern: '30 3 * * *', tz: 'UTC' },
      { name: SWEEP, opts: { attempts: 1 } },
    );
  }
}

@Processor(QueueNames.SESSION_SWEEP)
export class SessionSweepProcessor extends QueueProcessor {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(): Promise<PurgedSessionsDto> {
    const result = await this.commands.execute(new PurgeEndedSessionsCommand());
    this.logger.log({ deleted: result.deleted }, 'Ended sessions purged');
    return result;
  }
}
