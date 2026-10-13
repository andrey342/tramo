import { Logger } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { type AppConfig } from '@shared/infrastructure/config';

import { RedisLoginAttemptTracker } from './redis-login-attempt.tracker';

// What the tracker logs for each answer of its script; the script itself runs against Redis in
// the contract suite (iam-adapters.int-spec.ts).
describe('RedisLoginAttemptTracker logging', () => {
  const config = {
    auth: { lockout: { maxFailures: 5, baseLockSeconds: 60, maxLockSeconds: 3600 } },
  } as unknown as AppConfig;
  const trackerAnswering = (scriptAnswer: number): RedisLoginAttemptTracker =>
    new RedisLoginAttemptTracker(
      { eval: () => Promise.resolve(scriptAnswer) } as unknown as Redis,
      config,
    );
  let warnings: unknown[][];

  beforeEach(() => {
    warnings = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log the lock with the email masked when an attempt reaches the threshold', async () => {
    const lockedFor = await trackerAnswering(-60_000).begin('ana.garcia@example.com');

    expect(lockedFor).toBe(0);
    expect(warnings).toEqual([
      [{ account: 'a***@example.com', lockSeconds: 60 }, expect.stringContaining('locked')],
    ]);
  });

  it('should log a refused sign-in with the email masked when the account is locked', async () => {
    const lockedFor = await trackerAnswering(42_500).begin('ana.garcia@example.com');

    expect(lockedFor).toBe(43);
    expect(warnings).toEqual([
      [{ account: 'a***@example.com', retryAfterSeconds: 43 }, expect.stringContaining('refused')],
    ]);
    expect(JSON.stringify(warnings)).not.toContain('ana.garcia');
  });

  it('should log nothing when the attempt may proceed below the threshold', async () => {
    expect(await trackerAnswering(0).begin('ana.garcia@example.com')).toBe(0);
    expect(warnings).toEqual([]);
  });
});
