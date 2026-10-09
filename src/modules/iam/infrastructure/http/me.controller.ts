import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { ROLES } from '@shared/domain';
import { RequireScopes, Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { GetCurrentPrincipalQuery } from '../../application/queries/get-current-principal.query';

import { CurrentPrincipalResponse } from './auth.dto';

@ApiTags('auth')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('me')
export class MeController {
  constructor(private readonly queries: QueryBus) {}

  // Every user and any API key may ask who they are, so integrations can check their key.
  @Get()
  @Roles(...ROLES)
  @RequireScopes()
  @ApiOperation({ summary: 'Describe the authenticated user or API key' })
  me(@CurrentPrincipal() principal: Principal): Promise<CurrentPrincipalResponse> {
    return this.queries.execute(new GetCurrentPrincipalQuery(principal));
  }
}
