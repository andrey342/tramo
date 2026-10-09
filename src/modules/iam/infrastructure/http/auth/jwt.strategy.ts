import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { type Principal } from '@shared/application';
import { isRole, type Role } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import {
  type AccessTokenPayload,
  JWT_AUDIENCE,
  JWT_ISSUER,
} from '../../adapters/jwt-access-token.issuer';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.auth.jwtSecret,
      algorithms: ['HS256'],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      ignoreExpiration: false,
    });
  }

  // The token is already verified here; this maps its claims to the principal every controller
  // sees. Unknown roles (from a newer or tampered token) are dropped rather than trusted.
  // Returning false makes passport answer 401, the same as for an invalid signature.
  validate(payload: Partial<AccessTokenPayload>): Principal | false {
    if (typeof payload.sub !== 'string' || !Array.isArray(payload.roles)) {
      return false;
    }
    return {
      kind: 'user',
      userId: payload.sub,
      roles: (payload.roles as unknown[]).filter(
        (role): role is Role => typeof role === 'string' && isRole(role),
      ),
      centerId: typeof payload.cid === 'string' ? payload.cid : null,
    };
  }
}
