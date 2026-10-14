import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { type Queue } from 'bullmq';

import { FindCenterQuery } from '@modules/catalog/application/dto/center-lookup';
import { FindProgramQuery } from '@modules/catalog/application/dto/program-lookup';
import { GetProgramScoresQuery } from '@modules/origination/application/dto/program-scores';
import { QueueNames, withinQueueTimeout } from '@shared/infrastructure/queues';

import {
  type Programs,
  type ProgramScores,
  type QueueHealth,
} from '../../application/ports/reporting-ports';

// Asks catalog which center offers a program, through its public query (ADR 008).
@Injectable()
export class CatalogPrograms implements Programs {
  constructor(private readonly queries: QueryBus) {}

  async centerOf(programId: string): Promise<string | null> {
    return (await this.queries.execute(new FindProgramQuery(programId)))?.centerId ?? null;
  }

  async centerExists(centerId: string): Promise<boolean> {
    return (await this.queries.execute(new FindCenterQuery(centerId))) !== null;
  }
}

// Asks origination for the aggregate of a program's scores; the scores stay there.
@Injectable()
export class OriginationProgramScores implements ProgramScores {
  constructor(private readonly queries: QueryBus) {}

  of(programId: string): Promise<{ scoredApplications: number; averageScore: number | null }> {
    return this.queries.execute(new GetProgramScoresQuery(programId));
  }
}

// Dead letters are kept in their queue, waiting, until someone retries or removes them. While
// Redis is down the count is unknown (null) and the overview still answers: the call gives up
// after a short wait, and no new one is issued while the last is still waiting for Redis, so an
// outage does not pile commands up on the connection.
@Injectable()
export class BullQueueHealth implements QueueHealth {
  private readonly logger = new Logger(BullQueueHealth.name);
  private inFlight = false;

  constructor(@InjectQueue(QueueNames.DEAD_LETTER) private readonly queue: Queue) {}

  async deadLetters(): Promise<number | null> {
    if (this.inFlight) {
      return null;
    }
    this.inFlight = true;
    const counts = this.queue.getJobCounts('waiting', 'delayed').finally(() => {
      this.inFlight = false;
    });
    try {
      const { waiting = 0, delayed = 0 } = await withinQueueTimeout(counts);
      return waiting + delayed;
    } catch (error) {
      this.logger.warn({ err: error }, 'Dead letters could not be counted');
      return null;
    }
  }
}
