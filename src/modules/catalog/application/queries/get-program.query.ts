import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import {
  PROGRAM_REPOSITORY,
  type ProgramRepository,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';
import { canSeeUnpublishedPrograms } from '../center-access';
import { type CatalogProgramDto } from '../dto/program.dto';
import { PROGRAM_CATALOG, type ProgramCatalog } from '../ports/catalog-ports';
import { toProgramDto } from '../program.mapping';

export class GetProgramQuery extends Query<CatalogProgramDto> {
  constructor(
    readonly actor: Principal,
    readonly programId: string,
  ) {
    super();
  }
}

// Anyone sees a published program of an active center. Drafts and archived programs exist only
// for the people who manage them; everybody else gets 404.
@QueryHandler(GetProgramQuery)
export class GetProgramHandler implements IQueryHandler<GetProgramQuery> {
  constructor(
    @Inject(PROGRAM_CATALOG) private readonly catalog: ProgramCatalog,
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
  ) {}

  async execute(query: GetProgramQuery): Promise<CatalogProgramDto> {
    const published = await this.catalog.findPublished(query.programId);
    if (published) {
      return published;
    }
    const program = await this.programs.findById(query.programId);
    if (!program || !canSeeUnpublishedPrograms(query.actor, program.centerId)) {
      throw new EntityNotFoundError('Program', query.programId);
    }
    const center = await this.centers.findById(program.centerId);
    // Centers are never deleted; a program without one is corrupt data, not a missing program.
    if (!center) {
      throw new Error(
        `Program ${program.id} belongs to center ${program.centerId}, which does not exist.`,
      );
    }
    return { ...toProgramDto(program), centerName: center.name };
  }
}
