import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import {
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';
import { canSeePersonalData, findVisibleApplication } from '../application-access';
import { toApplicationDto } from '../application.mapping';
import { type ApplicationDto } from '../dto/application.dto';

export class GetApplicationQuery extends Query<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
  ) {
    super();
  }
}

// One aggregate by id through the repository (ADR 002). The center sees the status, not the
// student's personal data.
@QueryHandler(GetApplicationQuery)
export class GetApplicationHandler implements IQueryHandler<GetApplicationQuery> {
  constructor(
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
  ) {}

  async execute(query: GetApplicationQuery): Promise<ApplicationDto> {
    const application = await findVisibleApplication(
      this.applications,
      query.actor,
      query.applicationId,
    );
    return toApplicationDto(application, {
      withProfile: canSeePersonalData(query.actor, application),
    });
  }
}
