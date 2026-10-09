import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { USER_REPOSITORY, type UserRepository } from '../../domain';
import { type CurrentPrincipalDto } from '../dto/session.dto';

export class GetCurrentPrincipalQuery extends Query<CurrentPrincipalDto> {
  constructor(readonly principal: Principal) {
    super();
  }
}

@QueryHandler(GetCurrentPrincipalQuery)
export class GetCurrentPrincipalHandler implements IQueryHandler<GetCurrentPrincipalQuery> {
  constructor(@Inject(USER_REPOSITORY) private readonly users: UserRepository) {}

  async execute({ principal }: GetCurrentPrincipalQuery): Promise<CurrentPrincipalDto> {
    switch (principal.kind) {
      case 'api_key':
        return {
          kind: 'api_key',
          id: principal.apiKeyId,
          centerId: principal.centerId,
          scopes: principal.scopes,
        };
      case 'user': {
        const user = await this.users.findById(principal.userId);
        if (!user) {
          throw new EntityNotFoundError('User', principal.userId);
        }
        return {
          kind: 'user',
          id: user.id,
          email: user.email.value,
          roles: user.roles,
          centerId: user.centerId,
        };
      }
      case 'anonymous':
        throw new EntityNotFoundError('User', 'anonymous');
    }
  }
}
