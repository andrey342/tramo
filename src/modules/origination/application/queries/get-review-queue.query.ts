import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';

import { ApplicationAccessDeniedError } from '../../domain';
import { isStaff } from '../application-access';
import { type ApplicationSummaryDto } from '../dto/application.dto';
import { APPLICATION_QUERIES, type ApplicationQueries } from '../ports/origination-ports';

export class GetReviewQueueQuery extends Query<CursorPage<ApplicationSummaryDto>> {
  constructor(
    readonly actor: Principal,
    readonly page: PageRequest,
  ) {
    super();
  }
}

// Applications the engine sent to an analyst, the longest waiting first.
@QueryHandler(GetReviewQueueQuery)
export class GetReviewQueueHandler implements IQueryHandler<GetReviewQueueQuery> {
  constructor(@Inject(APPLICATION_QUERIES) private readonly queries: ApplicationQueries) {}

  async execute(query: GetReviewQueueQuery): Promise<CursorPage<ApplicationSummaryDto>> {
    if (!isStaff(query.actor)) {
      throw new ApplicationAccessDeniedError();
    }
    return await this.queries.reviewQueue(query.page);
  }
}
