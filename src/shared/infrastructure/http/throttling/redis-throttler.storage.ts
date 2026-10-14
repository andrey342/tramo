import { Logger } from '@nestjs/common';
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

// Every request asks for its counters, so Redis gets this long to answer.
export const THROTTLE_TIMEOUT_MS = 300;

const SKIPPED: ThrottlerStorageRecord = {
  totalHits: 0,
  timeToExpire: 0,
  isBlocked: false,
  timeToBlockExpire: 0,
};

// Fails open: if Redis is unavailable the request goes through. Losing rate limiting for a few
// seconds is better than turning a Redis outage into an outage of every endpoint. Idempotency, by
// contrast, fails closed because it protects money movements. While the client is not connected
// nothing is asked (the client would queue the command until Redis came back), and an answer that
// takes longer than THROTTLE_TIMEOUT_MS is not waited for. The outage is logged once.
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private skipping = false;

  constructor(
    private readonly redis: Redis,
    private readonly timeoutMs: number = THROTTLE_TIMEOUT_MS,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const prefix = `tramo:throttle:${throttlerName}:${key}`;
    if (this.redis.status !== 'ready') {
      return this.skip('Redis is not connected');
    }
    let reply: [number, number, number, number];
    let timer: NodeJS.Timeout | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Redis did not answer within ${String(this.timeoutMs)} ms`));
        }, this.timeoutMs);
      });
      reply = (await Promise.race([
        this.redis.eval(
          SCRIPT,
          2,
          `${prefix}:hits`,
          `${prefix}:blocked`,
          ttl,
          limit,
          blockDuration,
        ),
        timeout,
      ])) as [number, number, number, number];
    } catch (error) {
      return this.skip(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
    }
    this.skipping = false;
    const [totalHits, expiresInMs, blocked, blockedForMs] = reply;
    // The guard reports these in seconds (Retry-After, X-RateLimit-Reset).
    return {
      totalHits,
      timeToExpire: Math.max(Math.ceil(expiresInMs / 1000), 0),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(Math.ceil(blockedForMs / 1000), 0),
    };
  }

  private skip(reason: string): ThrottlerStorageRecord {
    if (!this.skipping) {
      this.skipping = true;
      this.logger.warn({ reason }, 'Rate limit skipped until Redis answers again');
    }
    return SKIPPED;
  }
}
