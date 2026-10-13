import { Controller, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems } from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { DisableUserCommand } from '../../application/commands/disable-user.command';

// Administration of accounts by Tramo admins.
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly commands: CommandBus) {}

  @Post(':userId/disable')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiNoContentResponse()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('admin')
  @Audited({ action: 'user.disable', resource: 'user', resourceIdParam: 'userId' })
  @ApiOperation({
    summary: 'Disable an account and end all its sessions (admin)',
    description:
      'The account can no longer sign in and its refresh tokens stop working at once. Access ' +
      'tokens already issued keep working until they expire (15 minutes). Disabling an account ' +
      'that is already disabled answers 204 as well.',
  })
  async disable(
    @CurrentPrincipal() actor: Principal,
    @Param('userId', ParseUUIDPipe) userId: string,
  ): Promise<void> {
    await this.commands.execute(new DisableUserCommand(actor, userId));
  }
}
