import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { GetProgramScoresQuery, type ProgramScoresDto } from '../dto/program-scores';
import { APPLICATION_QUERIES, type ApplicationQueries } from '../ports/origination-ports';

// Below this many scored applicants a mean says too much about each of them (with one, it is the
// score itself), and comparing two readings would give away the newest.
export const MIN_SCORED_FOR_AVERAGE = 10;
// The mean is rounded to a band, so a new applicant moves it only in steps.
export const SCORE_BAND = 5;

@QueryHandler(GetProgramScoresQuery)
export class GetProgramScoresHandler implements IQueryHandler<GetProgramScoresQuery> {
  constructor(@Inject(APPLICATION_QUERIES) private readonly queries: ApplicationQueries) {}

  async execute(query: GetProgramScoresQuery): Promise<ProgramScoresDto> {
    const { scoredApplications, averageScore } = await this.queries.programScores(query.programId);
    return {
      scoredApplications,
      averageScore:
        scoredApplications >= MIN_SCORED_FOR_AVERAGE && averageScore !== null
          ? Math.round(averageScore / SCORE_BAND) * SCORE_BAND
          : null,
    };
  }
}
