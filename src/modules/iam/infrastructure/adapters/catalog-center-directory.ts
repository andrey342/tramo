import { Injectable } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';

import { FindCenterQuery } from '@modules/catalog/application/dto/center-lookup';

import { type CenterDirectory, type CenterStanding } from '../../application/ports/iam-ports';

// Asks the catalog module through its public query, never through its tables (ADR 008).
@Injectable()
export class CatalogCenterDirectory implements CenterDirectory {
  constructor(private readonly queries: QueryBus) {}

  async find(centerId: string): Promise<CenterStanding | null> {
    const center = await this.queries.execute(new FindCenterQuery(centerId));
    return center ? { suspended: center.status === 'suspended' } : null;
  }
}
