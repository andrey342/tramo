import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { RequireScopes } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { GetCurrentPrincipalQuery } from '../../application/queries/get-current-principal.query';

import { CurrentPrincipalResponse } from './auth.dto';

@ApiTags('auth')
@ApiBearerAuth()
@ApiSecurity('api-key')
@Controller('me')
export class MeController {
  constructor(private readonly queries: QueryBus) {}

  // Any API key may ask who it is, so integrations can check their key.
  @Get()
  @RequireScopes()
  @ApiOperation({ summary: 'Describe the authenticated user or API key' })
  me(@CurrentPrincipal() principal: Principal): Promise<CurrentPrincipalResponse> {
    return this.queries.execute(new GetCurrentPrincipalQuery(principal));
  }
}
