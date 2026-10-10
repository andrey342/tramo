import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { CLOCK, type Clock } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import {
  type AccessTokenClaims,
  type AccessTokenIssuer,
  type IssuedAccessToken,
} from '../../application/ports/iam-ports';

export const JWT_ISSUER = 'tramo';
export const JWT_AUDIENCE = 'tramo-api';

export interface AccessTokenPayload {
  sub: string;
  roles: AccessTokenClaims['roles'];
  cid: string | null;
}

// Short-lived (15 minutes by default) and stateless: revocation happens at refresh time, so a
// stolen access token is useful for minutes, not days.
@Injectable()
export class JwtAccessTokenIssuer implements AccessTokenIssuer {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async issue(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const ttlSeconds = this.config.auth.accessTokenTtlSeconds;
    const issuedAt = Math.floor(this.clock.now().getTime() / 1000);
    // `iat` from the Clock, so `exp` (iat + ttl) and expiresAt below agree.
    const payload = {
      sub: claims.userId,
      roles: claims.roles,
      cid: claims.centerId,
      iat: issuedAt,
    } satisfies AccessTokenPayload & { iat: number };
    const token = await this.jwt.signAsync(payload, {
      expiresIn: ttlSeconds,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    return {
      token,
      expiresAt: new Date((issuedAt + ttlSeconds) * 1000),
      expiresInSeconds: ttlSeconds,
    };
  }
}
