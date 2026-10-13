import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { FINANCING_PLAN_REPOSITORY, type FinancingPlanRepository } from '../../domain';
import { FindUnpaidPrincipalQuery } from '../dto/plan-lookup';

@QueryHandler(FindUnpaidPrincipalQuery)
export class FindUnpaidPrincipalHandler implements IQueryHandler<FindUnpaidPrincipalQuery> {
  constructor(@Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository) {}

  async execute(
    query: FindUnpaidPrincipalQuery,
  ): Promise<readonly { readonly number: number; readonly principalCents: number }[] | null> {
    const plan = await this.plans.findByContractId(query.contractId);
    if (plan?.terms.kind !== 'installments') {
      return null;
    }
    const { schedule, paidInstallments } = plan.terms;
    return schedule
      .filter((row) => !paidInstallments.includes(row.number))
      .map((row) => ({ number: row.number, principalCents: row.principal.cents }));
  }
}
