import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';
import { toBillablePlanDto } from '../contract.mapping';
import { type ContractLookupDto, FindContractQuery } from '../dto/contract-lookup';

@QueryHandler(FindContractQuery)
export class FindContractHandler implements IQueryHandler<FindContractQuery> {
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
  ) {}

  async execute(query: FindContractQuery): Promise<ContractLookupDto | null> {
    const contract = await this.contracts.findById(query.contractId);
    if (!contract) {
      return null;
    }
    const plan = await this.plans.findByContractId(contract.id);
    return {
      id: contract.id,
      studentId: contract.studentId,
      centerId: contract.centerId,
      product: contract.terms.product.kind,
      status: contract.status,
      nextIsaPeriod: plan ? toBillablePlanDto(plan, 'active').nextIsaPeriod : null,
      planOpen: plan !== null,
    };
  }
}
