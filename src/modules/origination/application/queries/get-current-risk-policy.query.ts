import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import {
  ApplicationAccessDeniedError,
  RISK_POLICY_REPOSITORY,
  type RiskPolicyRepository,
} from '../../domain';
import { isStaff } from '../application-access';
import { toRiskPolicyDto } from '../application.mapping';
import { type RiskPolicyDto } from '../dto/risk-policy.dto';

export class GetCurrentRiskPolicyQuery extends Query<RiskPolicyDto> {
  constructor(readonly actor: Principal) {
    super();
  }
}

@QueryHandler(GetCurrentRiskPolicyQuery)
export class GetCurrentRiskPolicyHandler implements IQueryHandler<GetCurrentRiskPolicyQuery> {
  constructor(@Inject(RISK_POLICY_REPOSITORY) private readonly policies: RiskPolicyRepository) {}

  async execute(query: GetCurrentRiskPolicyQuery): Promise<RiskPolicyDto> {
    if (!isStaff(query.actor)) {
      throw new ApplicationAccessDeniedError();
    }
    const policy = await this.policies.findCurrent();
    if (!policy) {
      throw new Error('No risk policy in force; the first one is seeded by a migration.');
    }
    return toRiskPolicyDto(policy);
  }
}
