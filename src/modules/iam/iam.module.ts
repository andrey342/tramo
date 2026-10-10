import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { CreateCenterUserHandler } from './application/commands/create-center-user.command';
import { IssueApiKeyHandler } from './application/commands/issue-api-key.command';
import { LoginHandler } from './application/commands/login.command';
import { LogoutHandler } from './application/commands/logout.command';
import { RefreshSessionHandler } from './application/commands/refresh-session.command';
import { RegisterStudentHandler } from './application/commands/register-student.command';
import { RevokeApiKeyHandler } from './application/commands/revoke-api-key.command';
import {
  ACCESS_TOKEN_ISSUER,
  CENTER_DIRECTORY,
  CREDENTIAL_GENERATOR,
  LOGIN_ATTEMPTS,
  PASSWORD_HASHER,
  SESSION_SETTINGS,
  type SessionSettings,
} from './application/ports/iam-ports';
import { AuthenticateApiKeyHandler } from './application/queries/authenticate-api-key.query';
import { FindStudentHandler } from './application/queries/find-student.query';
import { GetCurrentPrincipalHandler } from './application/queries/get-current-principal.query';
import { ListApiKeysHandler } from './application/queries/list-api-keys.query';
import { SessionIssuer } from './application/session-issuer';
import { API_KEY_REPOSITORY, REFRESH_TOKEN_REPOSITORY, USER_REPOSITORY } from './domain';
import { Argon2PasswordHasher } from './infrastructure/adapters/argon2-password.hasher';
import { CatalogCenterDirectory } from './infrastructure/adapters/catalog-center-directory';
import { CryptoCredentialGenerator } from './infrastructure/adapters/crypto-credential.generator';
import { JwtAccessTokenIssuer } from './infrastructure/adapters/jwt-access-token.issuer';
import { RedisLoginAttemptTracker } from './infrastructure/adapters/redis-login-attempt.tracker';
import { ApiKeyOrmEntity } from './infrastructure/persistence/api-key.orm-entity';
import { RefreshTokenOrmEntity } from './infrastructure/persistence/refresh-token.orm-entity';
import { TypeOrmApiKeyRepository } from './infrastructure/persistence/typeorm-api-key.repository';
import { TypeOrmRefreshTokenRepository } from './infrastructure/persistence/typeorm-refresh-token.repository';
import { TypeOrmUserRepository } from './infrastructure/persistence/typeorm-user.repository';
import { UserOrmEntity } from './infrastructure/persistence/user.orm-entity';

const DAY_MS = 24 * 60 * 60 * 1000;

// Use cases, persistence and adapters of the identity context. Shared by both processes; the HTTP
// surface lives in IamHttpModule, which only the api imports.
@Module({
  imports: [
    TypeOrmModule.forFeature([UserOrmEntity, RefreshTokenOrmEntity, ApiKeyOrmEntity]),
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        secret: config.auth.jwtSecret,
        signOptions: { algorithm: 'HS256' },
      }),
    }),
  ],
  providers: [
    RegisterStudentHandler,
    LoginHandler,
    RefreshSessionHandler,
    LogoutHandler,
    GetCurrentPrincipalHandler,
    CreateCenterUserHandler,
    IssueApiKeyHandler,
    RevokeApiKeyHandler,
    ListApiKeysHandler,
    AuthenticateApiKeyHandler,
    FindStudentHandler,
    SessionIssuer,
    { provide: USER_REPOSITORY, useClass: TypeOrmUserRepository },
    { provide: REFRESH_TOKEN_REPOSITORY, useClass: TypeOrmRefreshTokenRepository },
    { provide: API_KEY_REPOSITORY, useClass: TypeOrmApiKeyRepository },
    { provide: PASSWORD_HASHER, useClass: Argon2PasswordHasher },
    { provide: ACCESS_TOKEN_ISSUER, useClass: JwtAccessTokenIssuer },
    { provide: CREDENTIAL_GENERATOR, useClass: CryptoCredentialGenerator },
    { provide: LOGIN_ATTEMPTS, useClass: RedisLoginAttemptTracker },
    { provide: CENTER_DIRECTORY, useClass: CatalogCenterDirectory },
    {
      provide: SESSION_SETTINGS,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): SessionSettings => ({
        refreshTokenTtlMs: config.auth.refreshTokenTtlDays * DAY_MS,
        sessionMaxLifetimeMs: config.auth.sessionMaxDays * DAY_MS,
      }),
    },
  ],
})
export class IamModule {}
