import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { PROGRAM_REPOSITORY, type ProgramRepository } from '../../domain';
import { FindProgramQuery, type ProgramSummaryDto } from '../dto/program-lookup';

@QueryHandler(FindProgramQuery)
export class FindProgramHandler implements IQueryHandler<FindProgramQuery> {
  constructor(@Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository) {}

  async execute(query: FindProgramQuery): Promise<ProgramSummaryDto | null> {
    const program = await this.programs.findById(query.programId);
    return program
      ? {
          id: program.id,
          centerId: program.centerId,
          name: program.details.name,
          durationWeeks: program.details.durationWeeks,
          status: program.status,
        }
      : null;
  }
}
