import { Inject, Injectable } from '@nestjs/common';
import { type HealthIndicatorResult, HealthIndicatorService } from '@nestjs/terminus';
import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../redis';

@Injectable()
export class RedisHealthIndicator {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly indicators: HealthIndicatorService,
  ) {}

  ping(key: string, timeoutMs: number): PromiseLike<HealthIndicatorResult> {
    return this.indicators
      .check(key)
      .attempt(async () => {
        await this.redis.ping();
      })
      .withTimeout(timeoutMs);
  }
}
