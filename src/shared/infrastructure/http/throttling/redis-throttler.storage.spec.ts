import { type Redis } from 'ioredis';

import { RedisThrottlerStorage } from './redis-throttler.storage';

const OPEN = { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };

describe('RedisThrottlerStorage', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should let requests through when Redis is unavailable', async () => {
    const redis = {
      status: 'ready',
      eval: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')),
    };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('client', 60_000, 10, 60_000, 'default')).resolves.toEqual(OPEN);
  });

  // The client would queue the command until Redis came back, holding every request meanwhile.
  it('should not ask Redis while it is not connected', async () => {
    const redis = { status: 'reconnecting', eval: jest.fn() };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('client', 60_000, 10, 60_000, 'default')).resolves.toEqual(OPEN);
    expect(redis.eval).not.toHaveBeenCalled();
  });

  it('should not wait for an answer longer than its timeout', async () => {
    jest.useFakeTimers();
    const redis = { status: 'ready', eval: jest.fn(() => new Promise(() => undefined)) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis, 300);

    const counted = storage.increment('client', 60_000, 10, 60_000, 'default');
    await jest.advanceTimersByTimeAsync(300);

    await expect(counted).resolves.toEqual(OPEN);
  });

  it('should report a blocked client in seconds when the script answers blocked', async () => {
    const redis = { status: 'ready', eval: jest.fn().mockResolvedValue([2, 59_001, 1, 29_500]) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('client', 60_000, 1, 30_000, 'auth')).resolves.toEqual({
      totalHits: 2,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });
});
