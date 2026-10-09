import { type ExecutionContext, Module, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { type Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../config';
import { REDIS_CLIENT } from '../../redis';

import { RedisThrottlerStorage } from './redis-throttler.storage';

export const DEFAULT_THROTTLER = 'default';
export const AUTH_THROTTLER = 'auth';
const AUTH_RATE_LIMITED = Symbol('AUTH_RATE_LIMITED');

// Credential endpoints get a second, much lower limit per client on top of the global one.
export const AuthRateLimited = (): ClassDecorator & MethodDecorator =>
  SetMetadata(AUTH_RATE_LIMITED, true);

function isAuthRateLimited(context: ExecutionContext): boolean {
  return [context.getHandler(), context.getClass()].some(
    (target) => Reflect.getMetadata(AUTH_RATE_LIMITED, target) === true,
  );
}

// Global per-client limit for every route; stricter limits (authentication) are declared on the
// routes with @Throttle. Health checks opt out with @SkipThrottle.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS_CLIENT],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [
          { name: DEFAULT_THROTTLER, ttl: config.throttling.ttlMs, limit: config.throttling.limit },
          {
            name: AUTH_THROTTLER,
            ttl: 60_000,
            limit: config.throttling.authLimit,
            skipIf: (context) => !isAuthRateLimited(context),
          },
        ],
        storage: new RedisThrottlerStorage(redis),
        errorMessage: 'Too many requests. Retry after the time given in the Retry-After header.',
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottlingModule {}
