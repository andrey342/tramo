import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { API_KEY_REPOSITORY, type ApiKeyRepository } from '../../domain';
import { assertCanManageCenter } from '../center-access';
import { toApiKeySummary } from '../commands/api-key.mapping';
import { type ApiKeySummaryDto } from '../dto/api-key.dto';
import { CENTER_DIRECTORY, type CenterDirectory } from '../ports/iam-ports';

export class ListApiKeysQuery extends Query<ApiKeySummaryDto[]> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
  ) {
    super();
  }
}

// A center has a handful of keys at most, so the list is not paginated.
@QueryHandler(ListApiKeysQuery)
export class ListApiKeysHandler implements IQueryHandler<ListApiKeysQuery> {
  constructor(
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CENTER_DIRECTORY) private readonly centers: CenterDirectory,
  ) {}

  async execute(query: ListApiKeysQuery): Promise<ApiKeySummaryDto[]> {
    assertCanManageCenter(query.actor, query.centerId);
    if (!(await this.centers.find(query.centerId))) {
      throw new EntityNotFoundError('TrainingCenter', query.centerId);
    }
    const keys = await this.apiKeys.listByCenter(query.centerId);
    return keys.map((key) => toApiKeySummary(key));
  }
}
