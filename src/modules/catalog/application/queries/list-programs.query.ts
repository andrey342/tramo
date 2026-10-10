import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest } from '@shared/application';
import { InvalidValueError } from '@shared/domain';

import { type CatalogProgramDto, type ProgramFilter } from '../dto/program.dto';
import { PROGRAM_CATALOG, type ProgramCatalog } from '../ports/catalog-ports';

export class ListProgramsQuery extends Query<CursorPage<CatalogProgramDto>> {
  constructor(
    readonly filter: ProgramFilter,
    readonly page: PageRequest,
  ) {
    super();
  }
}

// The public catalog. Open to anyone, so it only ever shows published programs of active centers.
@QueryHandler(ListProgramsQuery)
export class ListProgramsHandler implements IQueryHandler<ListProgramsQuery> {
  constructor(@Inject(PROGRAM_CATALOG) private readonly catalog: ProgramCatalog) {}

  execute(query: ListProgramsQuery): Promise<CursorPage<CatalogProgramDto>> {
    const { minPriceCents, maxPriceCents } = query.filter;
    if (
      minPriceCents !== undefined &&
      maxPriceCents !== undefined &&
      minPriceCents > maxPriceCents
    ) {
      throw new InvalidValueError('minPriceCents', 'The minimum price is above the maximum.');
    }
    return this.catalog.list(query.filter, query.page);
  }
}
