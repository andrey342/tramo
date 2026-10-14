import { createHash } from 'node:crypto';

import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { ProblemException } from '@shared/infrastructure/http';
import { maskEmail } from '@shared/infrastructure/logging';
import { REDIS_CLIENT } from '@shared/infrastructure/redis';

import { type LoginAttemptTracker } from '../../application/ports/iam-ports';

// Failures are forgotten a day after the last one.
const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;
// How long a sign-in waits for its lockout check.
export const LOCKOUT_CHECK_TIMEOUT_MS = 2_000;

// Check and count in one step, so parallel attempts cannot all pass the check before any of them
// is counted. The attempt that reaches the threshold sets the lock before its password is
// verified; a success clears it again.
//   KEYS: lock, failures   ARGV: maxFailures, baseLockMs, maxLockMs, failureWindowMs
//   Returns the remaining lock in ms when locked; otherwise the attempt may proceed and the answer
//   is 0, or minus the lock in ms when this attempt reached the threshold and set the lock.
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
  return -math.floor(lockMs)
end
return 0
`;

const unavailable = (): ProblemException =>
  new ProblemException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'sign_in_unavailable',
    'Signing in is unavailable for a moment. Try again shortly.',
    undefined,
    5,
  );

// After `maxFailures` consecutive failed attempts the account is locked for `baseLockSeconds`,
// doubling with each further failure up to `maxLockSeconds`. Keys hold a hash of the email, not
// the email. Locks and refusals are logged with the email masked, so operations see an account
// under attack (or locked on purpose) without the log naming it.
@Injectable()
export class RedisLoginAttemptTracker implements LoginAttemptTracker {
  private readonly logger = new Logger(RedisLoginAttemptTracker.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // Fails closed, and fast: without the count a password could be guessed without limit, so a
  // sign-in that cannot be checked is refused (503, retry shortly) instead of waiting for Redis.
  async begin(account: string): Promise<number> {
    const { maxFailures, baseLockSeconds, maxLockSeconds } = this.config.auth.lockout;
    // The client would queue the command until Redis came back.
    if (this.redis.status !== 'ready') {
      throw unavailable();
    }
    const answer = await this.checked(
      this.redis.eval(
        BEGIN_ATTEMPT_SCRIPT,
        2,
        this.key('lock', account),
        this.key('failures', account),
        maxFailures,
        baseLockSeconds * 1000,
        maxLockSeconds * 1000,
        FAILURE_WINDOW_MS,
      ) as Promise<number>,
    );
    if (answer > 0) {
      const retryAfterSeconds = Math.ceil(answer / 1000);
      this.logger.warn(
        { account: maskEmail(account), retryAfterSeconds },
        'Sign-in refused: the account is locked after repeated failures',
      );
      return retryAfterSeconds;
    }
    if (answer < 0) {
      this.logger.warn(
        { account: maskEmail(account), lockSeconds: Math.ceil(-answer / 1000) },
        'Failed sign-in limit reached: the account is locked unless this attempt succeeds',
      );
    }
    return 0;
  }

  async succeeded(account: string): Promise<void> {
    await this.redis.del(this.key('failures', account), this.key('lock', account));
  }

  private async checked(call: Promise<number>): Promise<number> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        call,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error('timeout'));
          }, LOCKOUT_CHECK_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      this.logger.warn(
        { err: error instanceof Error ? error.message : error },
        'Sign-in refused: the lockout check is unavailable',
      );
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }

  private key(kind: 'failures' | 'lock', account: string): string {
    const id = createHash('sha256').update(account).digest('hex');
    // The hash tag keeps both keys of an account in one slot, as the script needs on a cluster.
    return `tramo:iam:login:{${id}}:${kind}`;
  }
}
