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
    const header = req.headers.authorization ?? '';
    void (async () => {
      // A browser's first request carries no credentials: it only gets the challenge.
      if (header.length === 0) {
        challenge(res);
        return;
      }
      // The attempt is counted before the credentials are compared, in one step, so parallel
      // guesses cannot all pass the check before any of them is counted.
      const blockedForMs = await beginAttempt(options.redis, failuresKey);
      if (blockedForMs > 0) {
        res.setHeader('Retry-After', String(Math.ceil(blockedForMs / 1000)));
        res.status(429).end();
        return;
      }
      const supplied = header.startsWith('Basic ')
        ? Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
        : '';
      if (timingSafeEqual(digest(supplied), expected)) {
        await forgetAttempts(options.redis, failuresKey);
        next();
        return;
      }
      challenge(res);
    })().catch(next);
  };
}

function challenge(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="tramo-queues", charset="UTF-8"');
  res.status(401).end();
}

//   KEYS: attempts   ARGV: maxAttempts, windowMs
//   Returns the remaining block in ms, or 0 when the attempt may proceed (and was counted).
const BEGIN_ATTEMPT_SCRIPT = `
local attempts = tonumber(redis.call('GET', KEYS[1]) or '0')
if attempts >= tonumber(ARGV[1]) then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 1 then return 1 end
  return ttl
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2], 'NX')
return 0
`;

// Redis being unavailable must not lock operations out of the dashboard: the limiter fails open
// and the credentials are still checked.
async function beginAttempt(redis: Redis, key: string): Promise<number> {
  try {
    return (await redis.eval(
      BEGIN_ATTEMPT_SCRIPT,
      1,
      key,
      DASHBOARD_MAX_FAILURES,
      FAILURE_WINDOW_MS,
    )) as number;
  } catch {
    return 0;
  }
}

async function forgetAttempts(redis: Redis, key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    // Best effort, see beginAttempt.
  }
}
