import { type ExecutionContext, Injectable, Module, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, type ThrottlerLimitDetail, ThrottlerModule } from '@nestjs/throttler';
import { type Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../config';
import { REDIS_CLIENT } from '../../redis';

import { clientKey } from './client-key';
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

// The guard names the header of every throttler but `default` after it (`Retry-After-auth`);
// clients and proxies only know `Retry-After`, so every 429 carries it too.
@Injectable()
export class RetryAfterThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    const { res } = this.getRequestResponse(context);
    this.setResponseHeader(res, 'Retry-After', detail.timeToBlockExpire);
    await super.throwThrottlingException(context, detail);
  }
}

// Global per-client limit for every route; credential routes get the stricter auth limit on top
// with @AuthRateLimited(). Health checks opt out with @SkipThrottle.
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
        getTracker: (req: Record<string, unknown>) => clientKey(req.ip as string | undefined),
        errorMessage: 'Too many requests. Retry after the time given in the Retry-After header.',
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: RetryAfterThrottlerGuard }],
})
export class ThrottlingModule {}
