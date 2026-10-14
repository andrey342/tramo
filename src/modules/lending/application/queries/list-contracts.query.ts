import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';

import { type ContractStatus } from '../../domain';
import { isStaff } from '../contract-access';
import { type ContractFilter, type ContractSummaryDto } from '../dto/contract.dto';
import { CONTRACT_QUERIES, type ContractQueries } from '../ports/lending-ports';

export class ListContractsQuery extends Query<CursorPage<ContractSummaryDto>> {
  constructor(
    readonly actor: Principal,
    readonly filter: { readonly status?: ContractStatus; readonly centerId?: string },
    readonly page: PageRequest,
  ) {
    super();
  }
}

// A student sees their contracts, a center (its admins, or an API key reading the portfolio)
// the ones it is paid by, staff all of them, by center if they ask.
@QueryHandler(ListContractsQuery)
export class ListContractsHandler implements IQueryHandler<ListContractsQuery> {
  constructor(@Inject(CONTRACT_QUERIES) private readonly queries: ContractQueries) {}

  execute(query: ListContractsQuery): Promise<CursorPage<ContractSummaryDto>> {
    const scope = scopeOf(query);
    return scope
      ? this.queries.list(scope, query.page)
      : Promise.resolve({ data: [], nextCursor: null });
  }
}

// A center sees its own contracts only: asking for another center's finds none.
function scopeOf({ actor, filter }: ListContractsQuery): ContractFilter | null {
  const status = filter.status;
  if (isStaff(actor)) {
    return { status, centerId: filter.centerId };
  }
  const ownCenter = actor.kind === 'user' || actor.kind === 'api_key' ? actor.centerId : null;
  if (filter.centerId !== undefined && filter.centerId !== ownCenter) {
    return null;
  }
  if (actor.kind === 'api_key' && actor.scopes.includes('portfolio:read')) {
    return { status, centerId: actor.centerId };
  }
  if (actor.kind === 'user' && actor.roles.includes('center_admin') && actor.centerId) {
    return { status, centerId: actor.centerId };
  }
  if (actor.kind === 'user' && actor.roles.includes('student')) {
    return { status, studentId: actor.userId };
  }
  return null;
}
