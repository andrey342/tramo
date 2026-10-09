import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { type Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../../config';
import { REDIS_CLIENT } from '../../redis';

import { RedisThrottlerStorage } from './redis-throttler.storage';

export const DEFAULT_THROTTLER = 'default';

// Global per-client limit for every route; stricter limits (authentication) are declared on the
// routes with @Throttle. Health checks opt out with @SkipThrottle.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [APP_CONFIG, REDIS_CLIENT],
      useFactory: (config: AppConfig, redis: Redis) => ({
        throttlers: [
          { name: DEFAULT_THROTTLER, ttl: config.throttling.ttlMs, limit: config.throttling.limit },
        ],
        storage: new RedisThrottlerStorage(redis),
        errorMessage: 'Too many requests. Retry after the time given in the Retry-After header.',
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class ThrottlingModule {}
