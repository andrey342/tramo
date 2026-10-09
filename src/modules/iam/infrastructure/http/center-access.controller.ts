import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { CreateCenterUserCommand } from '../../application/commands/create-center-user.command';
import { IssueApiKeyCommand } from '../../application/commands/issue-api-key.command';
import { RevokeApiKeyCommand } from '../../application/commands/revoke-api-key.command';
import { ListApiKeysQuery } from '../../application/queries/list-api-keys.query';

import {
  ApiKeyResponse,
  CenterUserCreatedResponse,
  CreateCenterUserRequest,
  IssuedApiKeyResponse,
  IssueApiKeyRequest,
} from './center-access.dto';

// Who may act for a training center: its users and its integration API keys.
@ApiTags('center access')
@Controller('centers/:centerId')
export class CenterAccessController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Post('users')
  @Roles('admin')
  @Audited({ action: 'center_user.create', resource: 'center', resourceIdParam: 'centerId' })
  @ApiOperation({ summary: 'Create an administrator account for a training center (admin)' })
  createUser(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() body: CreateCenterUserRequest,
  ): Promise<CenterUserCreatedResponse> {
    return this.commands.execute(
      new CreateCenterUserCommand(actor, centerId, body.email, body.password),
    );
  }

  @Post('api-keys')
  @Roles('center_admin', 'admin')
  @Audited({ action: 'api_key.issue', resource: 'center', resourceIdParam: 'centerId' })
  @ApiOperation({ summary: 'Issue an API key for the center; the key is shown once' })
  issueApiKey(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() body: IssueApiKeyRequest,
  ): Promise<IssuedApiKeyResponse> {
    return this.commands.execute(new IssueApiKeyCommand(actor, centerId, body.name, body.scopes));
  }

  @Get('api-keys')
  @Roles('center_admin', 'admin')
  @ApiOperation({ summary: "List the center's API keys (without secrets)" })
  listApiKeys(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ): Promise<ApiKeyResponse[]> {
    return this.queries.execute(new ListApiKeysQuery(actor, centerId));
  }

  @Delete('api-keys/:keyId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles('center_admin', 'admin')
  @Audited({ action: 'api_key.revoke', resource: 'api_key', resourceIdParam: 'keyId' })
  @ApiOperation({ summary: 'Revoke an API key; requests with it fail from now on' })
  async revokeApiKey(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('keyId', ParseUUIDPipe) keyId: string,
  ): Promise<void> {
    await this.commands.execute(new RevokeApiKeyCommand(actor, centerId, keyId));
  }
}
