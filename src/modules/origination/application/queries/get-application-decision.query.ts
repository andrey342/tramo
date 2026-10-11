import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import {
  ApplicationAccessDeniedError,
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';
import { canSeePersonalData, findVisibleApplication } from '../application-access';
import { toDecisionDto } from '../application.mapping';
import { type DecisionDto } from '../dto/application.dto';

export class GetApplicationDecisionQuery extends Query<DecisionDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
  ) {
    super();
  }
}

// The explanation of a decision (score, factors, reasons, policy version) is about the student's
// finances: the student and staff see it, the training center does not.
@QueryHandler(GetApplicationDecisionQuery)
export class GetApplicationDecisionHandler implements IQueryHandler<GetApplicationDecisionQuery> {
  constructor(
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
  ) {}

  async execute(query: GetApplicationDecisionQuery): Promise<DecisionDto> {
    const application = await findVisibleApplication(
      this.applications,
      query.actor,
      query.applicationId,
    );
    if (!canSeePersonalData(query.actor, application)) {
      throw new ApplicationAccessDeniedError();
    }
    const decision = toDecisionDto(application);
    if (!decision) {
      throw new EntityNotFoundError('DecisionRecord', query.applicationId);
    }
    return decision;
  }
}
