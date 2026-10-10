import { createHash, timingSafeEqual } from 'node:crypto';

import { type NextFunction, type Request, type Response } from 'express';
import { type Redis } from 'ioredis';

import { clientKey } from '../http/throttling/client-key';

// The dashboard is an Express router mounted by Bull Board, outside Nest's guards and throttler,
// so it limits failed sign-ins itself: after MAX_FAILURES wrong attempts from one client in
// FAILURE_WINDOW_MS, every attempt from it is refused until the window ends.
export const DASHBOARD_MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

export function dashboardAuth(options: {
  username: string;
  password: string | undefined;
  redis: Redis;
}): (req: Request, res: Response, next: NextFunction) => void {
  // Hashing both sides first gives equal-length buffers, so timingSafeEqual can compare
  // credentials of any length without leaking it.
  const expected =
    options.password === undefined ? undefined : digest(`${options.username}:${options.password}`);

  return (req, res, next) => {
    if (!expected) {
      res.status(404).end();
      return;
    }
    const failuresKey = `tramo:queue-dashboard:failures:${clientKey(req.ip)}`;
    void (async () => {
      const blockedForMs = await lockedFor(options.redis, failuresKey);
      if (blockedForMs > 0) {
        res.setHeader('Retry-After', String(Math.ceil(blockedForMs / 1000)));
        res.status(429).end();
        return;
      }
      const header = req.headers.authorization ?? '';
      const supplied = header.startsWith('Basic ')
        ? Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
        : '';
      if (timingSafeEqual(digest(supplied), expected)) {
        next();
        return;
      }
      // A browser's first request carries no credentials; only wrong ones count as failures.
      if (header.length > 0) {
        await recordFailure(options.redis, failuresKey);
      }
      res.setHeader('WWW-Authenticate', 'Basic realm="tramo-queues", charset="UTF-8"');
      res.status(401).end();
    })().catch(next);
  };
}

// Redis being unavailable must not lock operations out of the dashboard: the limiter fails open
// and the credentials are still checked.
async function lockedFor(redis: Redis, key: string): Promise<number> {
  try {
    const [failures, ttl] = await Promise.all([redis.get(key), redis.pttl(key)]);
    return Number(failures ?? 0) >= DASHBOARD_MAX_FAILURES ? Math.max(ttl, 1) : 0;
  } catch {
    return 0;
  }
}

async function recordFailure(redis: Redis, key: string): Promise<void> {
  try {
    await redis.multi().incr(key).pexpire(key, FAILURE_WINDOW_MS, 'NX').exec();
  } catch {
    // Counting is best effort, see lockedFor.
  }
}
