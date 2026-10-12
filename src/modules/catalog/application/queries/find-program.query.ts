import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { PROGRAM_REPOSITORY, type ProgramRepository } from '../../domain';
import { FindProgramQuery } from '../dto/program-lookup';
import { type ProgramDto } from '../dto/program.dto';
import { toProgramDto } from '../program.mapping';

@QueryHandler(FindProgramQuery)
export class FindProgramHandler implements IQueryHandler<FindProgramQuery> {
  constructor(@Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository) {}

  async execute(query: FindProgramQuery): Promise<ProgramDto | null> {
    const program = await this.programs.findById(query.programId);
    return program ? toProgramDto(program) : null;
  }
}
