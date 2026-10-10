import { Inject } from '@nestjs/common';
import { type IQueryHandler, QueryHandler } from '@nestjs/cqrs';

import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '../../domain';
import { type CenterSummaryDto, FindCenterQuery } from '../dto/center-lookup';

@QueryHandler(FindCenterQuery)
export class FindCenterHandler implements IQueryHandler<FindCenterQuery> {
  constructor(
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
  ) {}

  async execute(query: FindCenterQuery): Promise<CenterSummaryDto | null> {
    const center = await this.centers.findById(query.centerId);
    return center ? { id: center.id, name: center.name, status: center.status } : null;
  }
}
