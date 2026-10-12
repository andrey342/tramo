import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { type BillablePlanDto, ListBillablePlansQuery } from '../dto/plan-lookup';
import { CONTRACT_QUERIES, type ContractQueries } from '../ports/lending-ports';

@QueryHandler(ListBillablePlansQuery)
export class ListBillablePlansHandler implements IQueryHandler<ListBillablePlansQuery> {
  constructor(@Inject(CONTRACT_QUERIES) private readonly queries: ContractQueries) {}

  execute(query: ListBillablePlansQuery): Promise<readonly BillablePlanDto[]> {
    return this.queries.billablePlans(query.afterContractId, query.limit);
  }
}
