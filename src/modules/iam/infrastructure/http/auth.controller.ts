import { Body, Controller, Header, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { AuthRateLimited } from '@shared/infrastructure/http';
import { Public } from '@shared/infrastructure/http/access.decorators';

import { LoginCommand } from '../../application/commands/login.command';
import { LogoutCommand } from '../../application/commands/logout.command';
import { RefreshSessionCommand } from '../../application/commands/refresh-session.command';
import { RegisterStudentCommand } from '../../application/commands/register-student.command';
import { type SessionTokensDto } from '../../application/dto/session.dto';

import {
  LoginRequest,
  RefreshTokenRequest,
  RegisteredResponse,
  RegisterStudentRequest,
  SessionTokensResponse,
} from './auth.dto';

@ApiTags('auth')
@Public()
// THROTTLE_AUTH_LIMIT requests per minute per client (10 by default), on top of the per-account
// lockout.
@AuthRateLimited()
@Controller('auth')
export class AuthController {
  constructor(private readonly commands: CommandBus) {}

  @Post('register')
  @ApiOperation({ summary: 'Create a student account' })
  register(@Body() body: RegisterStudentRequest): Promise<RegisteredResponse> {
    return this.commands.execute(new RegisterStudentCommand(body.email, body.password));
  }

  // Responses carrying tokens must not be stored by any cache (RFC 6749, section 5.1).
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exchange email and password for an access and a refresh token' })
  async login(@Body() body: LoginRequest): Promise<SessionTokensResponse> {
    return toResponse(await this.commands.execute(new LoginCommand(body.email, body.password)));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Rotate the refresh token',
    description:
      'Returns a new token pair. The presented refresh token stops working; presenting it again ' +
      'revokes the whole session.',
  })
  async refresh(@Body() body: RefreshTokenRequest): Promise<SessionTokensResponse> {
    return toResponse(await this.commands.execute(new RefreshSessionCommand(body.refreshToken)));
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'End the session the refresh token belongs to' })
  async logout(@Body() body: RefreshTokenRequest): Promise<void> {
    await this.commands.execute(new LogoutCommand(body.refreshToken));
  }
}

function toResponse(session: SessionTokensDto): SessionTokensResponse {
  return {
    accessToken: session.accessToken,
    tokenType: 'Bearer',
    expiresIn: session.accessTokenExpiresIn,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  };
}
