import { type NextFunction, type Request, type Response } from 'express';
import { Redis } from 'ioredis';

import { DASHBOARD_MAX_FAILURES, dashboardAuth } from './dashboard-auth';

interface Answer {
  status?: number;
  headers: Record<string, string>;
  passed: boolean;
}

describe('dashboardAuth (integration)', () => {
  let redis: Redis;

  beforeAll(() => {
    redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  });

  afterAll(async () => {
    await redis.quit();
  });

  const middleware = () => dashboardAuth({ username: 'ops', password: 'right-password', redis });

  // Runs the middleware once and waits for it to answer or to call next().
  function call(ip: string, credentials?: string): Promise<Answer> {
    return new Promise((resolve) => {
      const answer: Answer = { headers: {}, passed: false };
      const req = {
        ip,
        headers: credentials
          ? { authorization: `Basic ${Buffer.from(credentials).toString('base64')}` }
          : {},
      } as unknown as Request;
      const res = {
        setHeader: (name: string, value: string) => {
          answer.headers[name.toLowerCase()] = value;
        },
        status: (code: number) => {
          answer.status = code;
          return {
            end: () => {
              resolve(answer);
            },
          };
        },
      } as unknown as Response;
      const next: NextFunction = () => {
        answer.passed = true;
        resolve(answer);
      };
      middleware()(req, res, next);
    });
  }

  it('should let the right credentials through and ask for them otherwise', async () => {
    const ip = `10.0.0.${String(Math.floor(Math.random() * 200))}`;

    expect((await call(ip)).status).toBe(401);
    expect((await call(ip, 'ops:right-password')).passed).toBe(true);
  });

  it('should refuse a client that keeps guessing, even with the right password', async () => {
    const ip = `10.1.${String(Math.floor(Math.random() * 200))}.1`;
    for (let attempt = 0; attempt < DASHBOARD_MAX_FAILURES; attempt += 1) {
      expect((await call(ip, 'ops:guess')).status).toBe(401);
    }

    const blocked = await call(ip, 'ops:right-password');

    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect((await call('10.2.0.1', 'ops:right-password')).passed).toBe(true);
  });

  it('should let no more guesses through than the limit when they arrive in parallel', async () => {
    const ip = `10.3.${String(Math.floor(Math.random() * 200))}.1`;

    const answers = await Promise.all(Array.from({ length: 50 }, () => call(ip, 'ops:guess')));

    expect(answers.filter((answer) => answer.status === 401)).toHaveLength(DASHBOARD_MAX_FAILURES);
    expect(answers.filter((answer) => answer.status === 429)).toHaveLength(
      50 - DASHBOARD_MAX_FAILURES,
    );
  });
});
