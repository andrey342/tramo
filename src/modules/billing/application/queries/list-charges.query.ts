import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';

import { findVisibleContract } from '../billing-access';
import { type ChargeDto } from '../dto/billing.dto';
import {
  BILLING_QUERIES,
  type BillingQueries,
  REPAYMENT_PLANS,
  type RepaymentPlans,
} from '../ports/billing-ports';

// A contract's charges, newest first: the student and staff.
export class ListChargesQuery extends Query<CursorPage<ChargeDto>> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
    readonly page: PageRequest,
  ) {
    super();
  }
}

@QueryHandler(ListChargesQuery)
export class ListChargesHandler implements IQueryHandler<ListChargesQuery> {
  constructor(
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(BILLING_QUERIES) private readonly queries: BillingQueries,
  ) {}

  async execute(query: ListChargesQuery): Promise<CursorPage<ChargeDto>> {
    const contract = await findVisibleContract(this.plans, query.actor, query.contractId);
    return this.queries.listCharges(contract.id, query.page);
  }
}
