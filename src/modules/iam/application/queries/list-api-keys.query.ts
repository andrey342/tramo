import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import { API_KEY_REPOSITORY, type ApiKeyRepository } from '../../domain';
import { assertCanManageCenter } from '../center-access';
import { toApiKeySummary } from '../commands/api-key.mapping';
import { type ApiKeySummaryDto } from '../dto/api-key.dto';

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
  constructor(@Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository) {}

  async execute(query: ListApiKeysQuery): Promise<ApiKeySummaryDto[]> {
    assertCanManageCenter(query.actor, query.centerId);
    const keys = await this.apiKeys.listByCenter(query.centerId);
    return keys.map((key) => toApiKeySummary(key));
  }
}
