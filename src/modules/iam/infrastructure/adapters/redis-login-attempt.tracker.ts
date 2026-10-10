import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { REDIS_CLIENT } from '@shared/infrastructure/redis';

import { type LoginAttemptTracker } from '../../application/ports/iam-ports';

// Failures are forgotten a day after the last one.
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

// Check and count in one step, so parallel attempts cannot all pass the check before any of them
// is counted. The attempt that reaches the threshold sets the lock before its password is
// verified; a success clears it again.
//   KEYS: lock, failures   ARGV: maxFailures, baseLockMs, maxLockMs, failureWindowMs
//   Returns the remaining lock in ms, or 0 when the attempt may proceed.
const BEGIN_ATTEMPT_SCRIPT = `
local remaining = redis.call('PTTL', KEYS[1])
if remaining > 0 then
  return remaining
end
local count = redis.call('INCR', KEYS[2])
redis.call('PEXPIRE', KEYS[2], ARGV[4])
local maxFailures = tonumber(ARGV[1])
if count >= maxFailures then
  local lockMs = math.min(tonumber(ARGV[2]) * 2 ^ (count - maxFailures), tonumber(ARGV[3]))
  redis.call('SET', KEYS[1], '1', 'PX', math.floor(lockMs))
end
return 0
`;

// After `maxFailures` consecutive failed attempts the account is locked for `baseLockSeconds`,
// doubling with each further failure up to `maxLockSeconds`. Keys hold a hash of the email, not
// the email.
@Injectable()
export class RedisLoginAttemptTracker implements LoginAttemptTracker {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async begin(account: string): Promise<number> {
    const { maxFailures, baseLockSeconds, maxLockSeconds } = this.config.auth.lockout;
    const remainingMs = (await this.redis.eval(
      BEGIN_ATTEMPT_SCRIPT,
      2,
      this.key('lock', account),
      this.key('failures', account),
      maxFailures,
      baseLockSeconds * 1000,
      maxLockSeconds * 1000,
      FAILURE_WINDOW_MS,
    )) as number;
    return remainingMs > 0 ? Math.ceil(remainingMs / 1000) : 0;
  }

  async succeeded(account: string): Promise<void> {
    await this.redis.del(this.key('failures', account), this.key('lock', account));
  }

  private key(kind: 'failures' | 'lock', account: string): string {
    const id = createHash('sha256').update(account).digest('hex');
    // The hash tag keeps both keys of an account in one slot, as the script needs on a cluster.
    return `tramo:iam:login:{${id}}:${kind}`;
  }
}
