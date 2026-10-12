import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import { findVisibleContract } from '../billing-access';
import { type StatementDto } from '../dto/billing.dto';
import {
  BILLING_QUERIES,
  type BillingQueries,
  REPAYMENT_PLANS,
  type RepaymentPlans,
} from '../ports/billing-ports';

// The account statement of a contract: every charge, payment, write-off and cancellation in
// order, with the running balance the student owes.
export class GetStatementQuery extends Query<StatementDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
  ) {
    super();
  }
}

@QueryHandler(GetStatementQuery)
export class GetStatementHandler implements IQueryHandler<GetStatementQuery> {
  constructor(
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(BILLING_QUERIES) private readonly queries: BillingQueries,
  ) {}

  async execute(query: GetStatementQuery): Promise<StatementDto> {
    const contract = await findVisibleContract(this.plans, query.actor, query.contractId);
    let balanceCents = 0;
    const entries = (await this.queries.ledger(contract.id)).map((entry) => {
      balanceCents += entry.amountCents;
      return { ...entry, balanceCents };
    });
    return { contractId: contract.id, entries, balanceCents };
  }
}
