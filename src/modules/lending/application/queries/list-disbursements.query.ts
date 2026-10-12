import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';

import { ContractAccessDeniedError } from '../../domain';
import { isStaff } from '../contract-access';
import { type DisbursementDto, type DisbursementFilter } from '../dto/contract.dto';
import { CONTRACT_QUERIES, type ContractQueries } from '../ports/lending-ports';

// The payments to centers, for ops: filtered by status to find the failed ones to act on.
export class ListDisbursementsQuery extends Query<CursorPage<DisbursementDto>> {
  constructor(
    readonly actor: Principal,
    readonly filter: DisbursementFilter,
    readonly page: PageRequest,
  ) {
    super();
  }
}

@QueryHandler(ListDisbursementsQuery)
export class ListDisbursementsHandler implements IQueryHandler<ListDisbursementsQuery> {
  constructor(@Inject(CONTRACT_QUERIES) private readonly queries: ContractQueries) {}

  execute(query: ListDisbursementsQuery): Promise<CursorPage<DisbursementDto>> {
    if (!isStaff(query.actor)) {
      return Promise.reject(new ContractAccessDeniedError());
    }
    return this.queries.listDisbursements(query.filter, query.page);
  }
}
