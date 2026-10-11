import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';

import { ApplicationAccessDeniedError, type ApplicationStatus } from '../../domain';
import { isStaff } from '../application-access';
import { type ApplicationFilter, type ApplicationSummaryDto } from '../dto/application.dto';
import { APPLICATION_QUERIES, type ApplicationQueries } from '../ports/origination-ports';

export class ListApplicationsQuery extends Query<CursorPage<ApplicationSummaryDto>> {
  constructor(
    readonly actor: Principal,
    readonly status: ApplicationStatus | undefined,
    readonly page: PageRequest,
  ) {
    super();
  }
}

// Who sees which: a student their own applications, a training center those for its programs,
// staff all of them. The caller's identity sets the scope; clients only filter by status.
@QueryHandler(ListApplicationsQuery)
export class ListApplicationsHandler implements IQueryHandler<ListApplicationsQuery> {
  constructor(@Inject(APPLICATION_QUERIES) private readonly queries: ApplicationQueries) {}

  async execute(query: ListApplicationsQuery): Promise<CursorPage<ApplicationSummaryDto>> {
    const scope = scopeOf(query.actor, query.status);
    const page = await this.queries.list(scope, query.page);
    // A training center sees how its students' applications stand, not their scores.
    return scope.centerId
      ? { ...page, data: page.data.map((row) => ({ ...row, score: null })) }
      : page;
  }
}

function scopeOf(actor: Principal, status: ApplicationStatus | undefined): ApplicationFilter {
  if (isStaff(actor)) {
    return { status };
  }
  if (actor.kind === 'user' && actor.roles.includes('student')) {
    return { applicantId: actor.userId, status };
  }
  if (actor.kind === 'user' && actor.roles.includes('center_admin') && actor.centerId) {
    return { centerId: actor.centerId, status };
  }
  if (
    actor.kind === 'api_key' &&
    actor.scopes.some((scope) => scope === 'applications:read' || scope === 'applications:write')
  ) {
    return { centerId: actor.centerId, status };
  }
  throw new ApplicationAccessDeniedError();
}
