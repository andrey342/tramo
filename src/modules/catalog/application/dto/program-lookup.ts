import { Query } from '@nestjs/cqrs';

import { type CatalogProgramDto, type ProgramDto } from './program.dto';

// Part of the module's public surface: origination snapshots the program a student applies for.
// Only programs students can apply for are found: published, of an active center.
export class FindPublishedProgramQuery extends Query<CatalogProgramDto | null> {
  constructor(readonly programId: string) {
    super();
  }
}

// Any program, whatever its state: lending reads the course a contract finances, which may have
// been withdrawn from the catalog since the student applied.
export class FindProgramQuery extends Query<ProgramDto | null> {
  constructor(readonly programId: string) {
    super();
  }
}
