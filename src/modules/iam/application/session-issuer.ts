import { Inject, Injectable } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';

import {
  type User,
  REFRESH_TOKEN_REPOSITORY,
  RefreshToken,
  type RefreshTokenRepository,
} from '../domain';

import { type SessionTokensDto } from './dto/session.dto';
import {
  ACCESS_TOKEN_ISSUER,
  type AccessTokenIssuer,
  CREDENTIAL_GENERATOR,
  type CredentialGenerator,
  SESSION_SETTINGS,
  type SessionSettings,
} from './ports/iam-ports';

// Shared by login (new family) and refresh (next token of an existing family). Must run inside the
// caller's unit of work.
@Injectable()
export class SessionIssuer {
  constructor(
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(CREDENTIAL_GENERATOR) private readonly credentials: CredentialGenerator,
    @Inject(ACCESS_TOKEN_ISSUER) private readonly accessTokens: AccessTokenIssuer,
    @Inject(SESSION_SETTINGS) private readonly settings: SessionSettings,
  ) {}

  async issue(user: User, now: Date, familyId: string = uuidv7()): Promise<SessionTokensDto> {
    const secret = this.credentials.refreshToken();
    const refreshToken = RefreshToken.issue({
      id: uuidv7(),
      familyId,
      userId: user.id,
      tokenHash: secret.hash,
      now,
      ttlMs: this.settings.refreshTokenTtlMs,
    });
    await this.refreshTokens.save(refreshToken);
    const access = await this.accessTokens.issue({
      userId: user.id,
      roles: user.roles,
      centerId: user.centerId,
    });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: secret.value,
      refreshTokenExpiresAt: refreshToken.expiresAt,
    };
  }
}
