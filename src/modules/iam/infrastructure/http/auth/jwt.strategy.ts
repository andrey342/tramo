import { Inject, Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { type Principal } from '@shared/application';
import { isRole } from '@shared/domain';
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
  validate(payload: AccessTokenPayload): Principal {
    return {
      kind: 'user',
      userId: payload.sub,
      roles: payload.roles.filter((role) => isRole(role)),
      centerId: payload.cid,
    };
  }
}
