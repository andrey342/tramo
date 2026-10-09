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
});
