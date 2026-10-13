import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { averageOf, shareOf } from '../../domain';
import { type ProgramPerformanceDto } from '../dto/reporting.dto';
import {
  PROGRAM_SCORES,
  type ProgramScores,
  PROGRAMS,
  type Programs,
  REPORTING_STORE,
  type ReportingStore,
} from '../ports/reporting-ports';
import { assertCanSeeCenter } from '../reporting-access';

// How a program converts: applications, the share approved among those decided, the mean amount
// asked and how its applicants scored (an aggregate from origination). A program of another
// center does not exist for this one.
export class GetProgramPerformanceQuery extends Query<ProgramPerformanceDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly programId: string,
  ) {
    super();
  }
}

@QueryHandler(GetProgramPerformanceQuery)
export class GetProgramPerformanceHandler implements IQueryHandler<GetProgramPerformanceQuery> {
  constructor(
    @Inject(REPORTING_STORE) private readonly store: ReportingStore,
    @Inject(PROGRAMS) private readonly programs: Programs,
    @Inject(PROGRAM_SCORES) private readonly scores: ProgramScores,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(query: GetProgramPerformanceQuery): Promise<ProgramPerformanceDto> {
    assertCanSeeCenter(query.actor, query.centerId);
    if ((await this.programs.centerOf(query.programId)) !== query.centerId) {
      throw new EntityNotFoundError('Program', query.programId);
    }
    const [figures, scores] = await Promise.all([
      this.store.programFigures(query.programId),
      this.scores.of(query.programId),
    ]);
    return {
      centerId: query.centerId,
      programId: query.programId,
      applications: figures.applications,
      approved: figures.approved,
      rejected: figures.rejected,
      approvalRateBasisPoints:
        shareOf(figures.approved, figures.approved + figures.rejected)?.basisPoints ?? null,
      averageTicketCents: averageOf(figures.amountCents, figures.pricedApplications)?.cents ?? null,
      scoredApplications: scores.scoredApplications,
      averageScore: scores.averageScore,
      generatedAt: this.clock.now(),
    };
  }
}
