import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Queue } from 'bullmq';

import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { RebuildProjectionsCommand } from '../../application/commands/rebuild-projections.command';
import { type RebuildJobs } from '../../application/ports/reporting-ports';

const REBUILD = 'reporting.rebuild';

interface RebuildJob extends CorrelatedJobData {
  readonly requestedBy: string | null;
}

// One rebuild at a time: the job id is fixed while one waits or runs (BullMQ adds nothing for an
// id it holds), and a finished one is removed, so the next request queues a new one.
@Injectable()
export class QueuedRebuildJobs implements RebuildJobs {
  constructor(
    @InjectQueue(QueueNames.REPORTING_REBUILD) private readonly queue: Queue<RebuildJob>,
  ) {}

  async request(requestedBy: string | null): Promise<boolean> {
    const existing = await this.queue.getJob(REBUILD);
    if (existing) {
      const state = await existing.getState();
      if (state !== 'completed' && state !== 'failed' && state !== 'unknown') {
        return false;
      }
      // A finished one kept by an older setting: it no longer holds the id.
      await existing.remove().catch(() => undefined);
    }
    await this.queue.add(
      REBUILD,
      { requestedBy, correlationId: null },
      {
        jobId: REBUILD,
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
    // Two requests at the same instant both answer true; only one job exists.
    return true;
  }
}

@Processor(QueueNames.REPORTING_REBUILD)
export class RebuildProcessor extends QueueProcessor<RebuildJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(): Promise<unknown> {
    const applied = await this.commands.execute(new RebuildProjectionsCommand());
    this.logger.log({ applied }, 'Reporting read models rebuilt');
    return applied;
  }
}
