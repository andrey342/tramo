import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { FindPublishedProgramQuery } from '../dto/program-lookup';
import { type CatalogProgramDto } from '../dto/program.dto';
import { PROGRAM_CATALOG, type ProgramCatalog } from '../ports/catalog-ports';

@QueryHandler(FindPublishedProgramQuery)
export class FindPublishedProgramHandler implements IQueryHandler<FindPublishedProgramQuery> {
  constructor(@Inject(PROGRAM_CATALOG) private readonly catalog: ProgramCatalog) {}

  execute(query: FindPublishedProgramQuery): Promise<CatalogProgramDto | null> {
    return this.catalog.findPublished(query.programId);
  }
}
