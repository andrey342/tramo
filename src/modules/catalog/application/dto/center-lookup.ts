import { Query } from '@nestjs/cqrs';

import { type CenterStatus } from '../../domain';

export interface CenterSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly status: CenterStatus;
}

// Part of the module's public surface: other modules ask whether a training center exists, and
// in what state, through the query bus instead of reading catalog's tables.
export class FindCenterQuery extends Query<CenterSummaryDto | null> {
  constructor(readonly centerId: string) {
    super();
  }
}
