import { Query } from '@nestjs/cqrs';

import { type CatalogProgramDto } from './program.dto';

// Part of the module's public surface: origination snapshots the program a student applies for.
// Only programs students can apply for are found: published, of an active center.
export class FindPublishedProgramQuery extends Query<CatalogProgramDto | null> {
  constructor(readonly programId: string) {
    super();
  }
}
