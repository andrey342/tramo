import { type ThrottlerStorage } from '@nestjs/throttler';
import { type Redis } from 'ioredis';

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

// Fixed window per key, evaluated atomically in Redis so every api instance shares the counters.
// Once the limit is exceeded the key is blocked for `blockDuration`.
const SCRIPT = `
local hitsKey = KEYS[1]
local blockKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
local blockDuration = tonumber(ARGV[3])

local blockedFor = redis.call('PTTL', blockKey)
if blockedFor > 0 then
  local hits = tonumber(redis.call('GET', hitsKey) or '0')
  return { hits, redis.call('PTTL', hitsKey), 1, blockedFor }
end

local hits = redis.call('INCR', hitsKey)
if hits == 1 then
  redis.call('PEXPIRE', hitsKey, ttl)
end
local expiresIn = redis.call('PTTL', hitsKey)
if hits > limit then
  redis.call('SET', blockKey, '1', 'PX', blockDuration)
  return { hits, expiresIn, 1, blockDuration }
end
return { hits, expiresIn, 0, 0 }
`;

export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const prefix = `tramo:throttle:${throttlerName}:${key}`;
    const [totalHits, expiresInMs, blocked, blockedForMs] = (await this.redis.eval(
      SCRIPT,
      2,
      `${prefix}:hits`,
      `${prefix}:blocked`,
      ttl,
      limit,
      blockDuration,
    )) as [number, number, number, number];
    // The guard reports these in seconds (Retry-After, X-RateLimit-Reset).
    return {
      totalHits,
      timeToExpire: Math.max(Math.ceil(expiresInMs / 1000), 0),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(Math.ceil(blockedForMs / 1000), 0),
    };
  }
}
