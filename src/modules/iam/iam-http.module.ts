import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';

import { IamModule } from './iam.module';
import { AuthenticationGuard } from './infrastructure/http/auth/authentication.guard';
import { AuthorizationGuard } from './infrastructure/http/auth/authorization.guard';
import { JwtStrategy } from './infrastructure/http/auth/jwt.strategy';
import { AuthController } from './infrastructure/http/auth.controller';
import { MeController } from './infrastructure/http/me.controller';

// The api's door: auth endpoints plus the global guards. Authentication runs first and attaches
// the principal; authorization then checks roles and API key scopes declared on each route.
@Module({
  imports: [IamModule, PassportModule],
  controllers: [AuthController, MeController],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: AuthorizationGuard },
  ],
})
export class IamHttpModule {}
