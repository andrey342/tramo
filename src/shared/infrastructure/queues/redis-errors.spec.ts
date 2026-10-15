import { Logger } from '@nestjs/common';

import { isConnectionError, REDIS_ERROR_LOG_INTERVAL_MS, RedisErrorReporter } from './redis-errors';

const reset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

describe('Redis error reporting', () => {
  const logged: Record<'warn' | 'error', unknown[][]> = { warn: [], error: [] };

  beforeEach(() => {
    for (const level of ['warn', 'error'] as const) {
      logged[level] = [];
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged[level].push(args);
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should tell connection failures from other errors', () => {
    expect(isConnectionError(reset())).toBe(true);
    expect(isConnectionError(new Error('Connection is closed.'))).toBe(true);
    expect(
      isConnectionError(new Error('Reached the max retries per request limit (which is 3).')),
    ).toBe(true);
    expect(isConnectionError(new Error('Missing lock for job 42. moveToFinished'))).toBe(false);
  });

  it('should say a connection failure at most once a minute', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const reporter = new RedisErrorReporter(new Logger('Queues'), 'Queue', { queue: 'events.iam' });

    reporter.report(reset());
    reporter.report(reset());
    now.mockReturnValue(1_000_000 + REDIS_ERROR_LOG_INTERVAL_MS);
    reporter.report(new Error('Connection is closed.'));

    expect(logged.warn).toEqual([
      [{ queue: 'events.iam', err: 'read ECONNRESET' }, 'Queue cannot reach Redis'],
      [{ queue: 'events.iam', err: 'Connection is closed.' }, 'Queue cannot reach Redis'],
    ]);
    expect(logged.error).toEqual([]);
  });

  it('should say any other error each time, even while connection failures are quiet', () => {
    const reporter = new RedisErrorReporter(new Logger('Worker'), 'Worker');

    reporter.report(reset());
    reporter.report(new Error('Missing lock for job 42. moveToFinished'));
    reporter.report(new Error('Missing lock for job 43. moveToFinished'));

    expect(logged.warn).toHaveLength(1);
    expect(logged.error).toEqual([
      [{ err: 'Missing lock for job 42. moveToFinished' }, 'Worker error'],
      [{ err: 'Missing lock for job 43. moveToFinished' }, 'Worker error'],
    ]);
  });
});
