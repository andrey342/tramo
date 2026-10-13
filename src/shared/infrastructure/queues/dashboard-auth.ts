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
      const supplied = header.startsWith('Basic ')
        ? Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
        : '';
      // Only wrong credentials are counted, so an operator's dashboard firing many requests at
      // once is never refused. Either way the answer waits for the block check, which is atomic
      // with the count: of a burst of parallel guesses, only those that reached Redis before the
      // limit get an answer other than 429, as if they had arrived one by one.
      const matches = timingSafeEqual(digest(supplied), expected);
      const blockedForMs = await (matches ? admit : recordFailure)(options.redis, failuresKey);
      if (blockedForMs > 0) {
        res.setHeader('Retry-After', String(Math.ceil(blockedForMs / 1000)));
        res.status(429).end();
        return;
      }
      if (matches) {
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

// Both scripts answer the remaining block in ms, or 0 when the client is not blocked.
//   KEYS: failures   ARGV: maxFailures, windowMs
// A wrong attempt is counted unless the client is already blocked.
const RECORD_FAILURE_SCRIPT = `
local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
if failures >= tonumber(ARGV[1]) then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 1 then return 1 end
  return ttl
end
redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2], 'NX')
return 0
`;

// The right credentials from a blocked client are refused too (a guess that happens to be right
// must not get through); otherwise they clear the client's failures.
const ADMIT_SCRIPT = `
local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
if failures >= tonumber(ARGV[1]) then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 1 then return 1 end
  return ttl
end
if failures > 0 then redis.call('DEL', KEYS[1]) end
return 0
`;

const recordFailure = (redis: Redis, key: string): Promise<number> =>
  runLimiter(redis, RECORD_FAILURE_SCRIPT, key);

const admit = (redis: Redis, key: string): Promise<number> => runLimiter(redis, ADMIT_SCRIPT, key);

// Redis being unavailable must not lock operations out of the dashboard: the limiter fails open
// and the credentials are still checked.
async function runLimiter(redis: Redis, script: string, key: string): Promise<number> {
  try {
    return (await redis.eval(script, 1, key, DASHBOARD_MAX_FAILURES, FAILURE_WINDOW_MS)) as number;
  } catch {
    return 0;
  }
}
