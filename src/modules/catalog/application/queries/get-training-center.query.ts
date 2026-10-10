import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '../../domain';
import { assertCanView } from '../center-access';
import { type TrainingCenterDto } from '../dto/training-center.dto';
import { toTrainingCenterDto } from '../training-center.mapping';

export class GetTrainingCenterQuery extends Query<TrainingCenterDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
  ) {
    super();
  }
}

// One center by id, read through the repository (ADR 002, bounded single-aggregate read).
@QueryHandler(GetTrainingCenterQuery)
export class GetTrainingCenterHandler implements IQueryHandler<GetTrainingCenterQuery> {
  constructor(
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
  ) {}

  async execute(query: GetTrainingCenterQuery): Promise<TrainingCenterDto> {
    assertCanView(query.actor, query.centerId);
    const center = await this.centers.findById(query.centerId);
    if (!center) {
      throw new EntityNotFoundError('TrainingCenter', query.centerId);
    }
    return toTrainingCenterDto(center);
  }
}
