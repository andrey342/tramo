import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { ROLES } from '@shared/domain';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems } from '@shared/infrastructure/http';
import { RequireScopes, Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { RevokeOwnSessionsCommand } from '../../application/commands/revoke-own-sessions.command';
import { GetCurrentPrincipalQuery } from '../../application/queries/get-current-principal.query';

import { CurrentPrincipalResponse } from './auth.dto';

// Security in the document comes from @Roles (bearer) and @RequireScopes (API key) per route.
@ApiTags('auth')
@Controller('me')
export class MeController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  // Every user and any API key may ask who they are, so integrations can check their key.
  @Get()
  @ApiProblems(401, 403)
  @ApiOkResponse({ type: CurrentPrincipalResponse })
  @Roles(...ROLES)
  @RequireScopes()
  @ApiOperation({ summary: 'Describe the authenticated user or API key' })
  me(@CurrentPrincipal() principal: Principal): Promise<CurrentPrincipalResponse> {
    return this.queries.execute(new GetCurrentPrincipalQuery(principal));
  }

  // Users only: no @RequireScopes, so an API key gets 403.
  @Post('sessions/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiProblems(401, 403)
  @ApiNoContentResponse()
  @Roles(...ROLES)
  @Audited({ action: 'session.revoke_all', resource: 'user' })
  @ApiOperation({
    summary: 'Sign out everywhere: end every session of the caller',
    description:
      'Every refresh token of every session of the user stops working, this one included. ' +
      'Access tokens already issued keep working until they expire (15 minutes).',
  })
  async revokeSessions(@CurrentPrincipal() principal: Principal): Promise<void> {
    await this.commands.execute(new RevokeOwnSessionsCommand(principal));
  }
}
