import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { type Queue } from 'bullmq';

import { FindProgramQuery } from '@modules/catalog/application/dto/program-lookup';
import { GetProgramScoresQuery } from '@modules/origination/application/dto/program-scores';
import { QueueNames } from '@shared/infrastructure/queues';

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
}

// Asks origination for the aggregate of a program's scores; the scores stay there.
@Injectable()
export class OriginationProgramScores implements ProgramScores {
  constructor(private readonly queries: QueryBus) {}

  of(programId: string): Promise<{ scoredApplications: number; averageScore: number | null }> {
    return this.queries.execute(new GetProgramScoresQuery(programId));
  }
}

// Dead letters are kept in their queue, waiting, until someone retries or removes them.
@Injectable()
export class BullQueueHealth implements QueueHealth {
  constructor(@InjectQueue(QueueNames.DEAD_LETTER) private readonly queue: Queue) {}

  async deadLetters(): Promise<number> {
    const counts = await this.queue.getJobCounts('waiting', 'delayed');
    return (counts.waiting ?? 0) + (counts.delayed ?? 0);
  }
}
