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

// One rebuild at a time: the job id is fixed while one waits or runs, and freed once it ends, so
// the next request queues a new one.
@Injectable()
export class QueuedRebuildJobs implements RebuildJobs {
  constructor(
    @InjectQueue(QueueNames.REPORTING_REBUILD) private readonly queue: Queue<RebuildJob>,
  ) {}

  async request(requestedBy: string | null): Promise<boolean> {
    const existing = await this.queue.getJob(REBUILD);
    const state = existing ? await existing.getState() : undefined;
    if (state && state !== 'completed' && state !== 'failed') {
      return false;
    }
    await existing?.remove();
    await this.queue.add(
      REBUILD,
      { requestedBy, correlationId: null },
      { jobId: REBUILD, attempts: 3, backoff: { type: 'exponential', delay: 10_000 } },
    );
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
