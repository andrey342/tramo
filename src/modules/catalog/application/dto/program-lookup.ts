import { Query } from '@nestjs/cqrs';

import { type ProgramStatus } from '../../domain';

// The bounds of what a program may offer, so origination validates an application's term against
// the same limits the catalog publishes programs with.
export { FINANCING_LIMITS } from '../../domain';

import { type CatalogProgramDto } from './program.dto';

// Part of the module's public surface: origination snapshots the program a student applies for.
// Only programs students can apply for are found: published, of an active center.
export class FindPublishedProgramQuery extends Query<CatalogProgramDto | null> {
  constructor(readonly programId: string) {
    super();
  }
}

export interface ProgramSummaryDto {
  readonly id: string;
  readonly centerId: string;
  readonly name: string;
  readonly durationWeeks: number;
  readonly status: ProgramStatus;
}

// Any program, whatever its state: lending reads the course a contract finances, which may have
// been withdrawn from the catalog since the student applied.
export class FindProgramQuery extends Query<ProgramSummaryDto | null> {
  constructor(readonly programId: string) {
    super();
  }
}
