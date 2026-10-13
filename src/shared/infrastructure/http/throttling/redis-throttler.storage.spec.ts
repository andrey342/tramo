import { type Redis } from 'ioredis';

import { RedisThrottlerStorage } from './redis-throttler.storage';

describe('RedisThrottlerStorage', () => {
  it('should let requests through when Redis is unavailable', async () => {
    const redis = { eval: jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('client', 60_000, 10, 60_000, 'default')).resolves.toEqual({
      totalHits: 0,
      timeToExpire: 0,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
  });

  it('should report a blocked client in seconds when the script answers blocked', async () => {
    const redis = { eval: jest.fn().mockResolvedValue([2, 59_001, 1, 29_500]) };
    const storage = new RedisThrottlerStorage(redis as unknown as Redis);

    await expect(storage.increment('client', 60_000, 1, 30_000, 'auth')).resolves.toEqual({
      totalHits: 2,
      timeToExpire: 60,
      isBlocked: true,
      timeToBlockExpire: 30,
    });
  });
});
