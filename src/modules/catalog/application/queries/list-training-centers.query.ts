import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';

import { type CenterStatus } from '../../domain';
import { assertCanOperate } from '../center-access';
import { type TrainingCenterDto } from '../dto/training-center.dto';
import { TRAINING_CENTER_QUERIES, type TrainingCenterQueries } from '../ports/catalog-ports';

export class ListTrainingCentersQuery extends Query<CursorPage<TrainingCenterDto>> {
  constructor(
    readonly actor: Principal,
    readonly status: CenterStatus | null,
    readonly page: PageRequest,
  ) {
    super();
  }
}

// Staff find the centers they operate, for instance those still waiting for their VAT check.
@QueryHandler(ListTrainingCentersQuery)
export class ListTrainingCentersHandler implements IQueryHandler<ListTrainingCentersQuery> {
  constructor(@Inject(TRAINING_CENTER_QUERIES) private readonly centers: TrainingCenterQueries) {}

  execute(query: ListTrainingCentersQuery): Promise<CursorPage<TrainingCenterDto>> {
    assertCanOperate(query.actor, 'all');
    return this.centers.list(query.status ? { status: query.status } : {}, query.page);
  }
}
