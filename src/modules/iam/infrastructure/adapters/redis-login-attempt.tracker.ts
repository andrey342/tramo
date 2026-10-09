import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { REDIS_CLIENT } from '@shared/infrastructure/redis';

import { type LoginAttemptTracker } from '../../application/ports/iam-ports';

// Failures are forgotten a day after the last one.
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

// After `maxFailures` consecutive failures the account is locked for `baseLockSeconds`, doubling
// with each further failure up to `maxLockSeconds`. Keys hold a hash of the email, not the email.
@Injectable()
export class RedisLoginAttemptTracker implements LoginAttemptTracker {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async lockedFor(account: string): Promise<number> {
    const remainingMs = await this.redis.pttl(this.key('lock', account));
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  async recordFailure(account: string): Promise<void> {
    const failuresKey = this.key('failures', account);
    const results = await this.redis
      .multi()
      .incr(failuresKey)
      .pexpire(failuresKey, FAILURE_WINDOW_MS)
      .exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const { maxFailures, baseLockSeconds, maxLockSeconds } = this.config.auth.lockout;
    if (count >= maxFailures) {
      const seconds = Math.min(baseLockSeconds * 2 ** (count - maxFailures), maxLockSeconds);
      await this.redis.set(this.key('lock', account), '1', 'PX', seconds * 1000);
    }
  }

  async reset(account: string): Promise<void> {
    await this.redis.del(this.key('failures', account), this.key('lock', account));
  }

  private key(kind: 'failures' | 'lock', account: string): string {
    const id = createHash('sha256').update(account).digest('hex');
    return `tramo:iam:login:${kind}:${id}`;
  }
}
