import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  FINANCING_PLAN_REPOSITORY,
  type FinancingPlanRepository,
} from '../../domain';
import { canSeeRepayment, findVisibleContract } from '../contract-access';
import { toScheduleDto } from '../contract.mapping';
import { type ScheduleDto } from '../dto/contract.dto';

// The repayment plan: the instalment table, or where an ISA stands. It exists once the contract
// is active.
export class GetContractScheduleQuery extends Query<ScheduleDto> {
  constructor(
    readonly actor: Principal,
    readonly contractId: string,
  ) {
    super();
  }
}

@QueryHandler(GetContractScheduleQuery)
export class GetContractScheduleHandler implements IQueryHandler<GetContractScheduleQuery> {
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
  ) {}

  async execute(query: GetContractScheduleQuery): Promise<ScheduleDto> {
    const contract = await findVisibleContract(
      this.contracts,
      query.actor,
      query.contractId,
      canSeeRepayment,
    );
    const plan = await this.plans.findByContractId(contract.id);
    if (!plan) {
      throw new EntityNotFoundError('FinancingPlan', contract.id);
    }
    return toScheduleDto(plan);
  }
}
