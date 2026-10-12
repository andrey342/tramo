import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { GetProgramScoresQuery, type ProgramScoresDto } from '../dto/program-scores';
import { APPLICATION_QUERIES, type ApplicationQueries } from '../ports/origination-ports';

@QueryHandler(GetProgramScoresQuery)
export class GetProgramScoresHandler implements IQueryHandler<GetProgramScoresQuery> {
  constructor(@Inject(APPLICATION_QUERIES) private readonly queries: ApplicationQueries) {}

  execute(query: GetProgramScoresQuery): Promise<ProgramScoresDto> {
    return this.queries.programScores(query.programId);
  }
}
