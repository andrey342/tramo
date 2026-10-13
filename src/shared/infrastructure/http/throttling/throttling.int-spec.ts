import { Controller, type INestApplication, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Redis } from 'ioredis';
import request from 'supertest';

import { APP_CONFIG, type AppConfig } from '../../config';
import { CoreModule } from '../../core.module';
import { REDIS_CLIENT } from '../../redis';
import { configureHttpApp } from '../configure-http-app';
import { HttpPlatformModule } from '../http-platform.module';

import { RedisThrottlerStorage } from './redis-throttler.storage';
import { AuthRateLimited } from './throttling.module';

@Controller('probe')
class ProbeController {
  @Post('sign-in')
  @AuthRateLimited()
  signIn(): { ok: true } {
    return { ok: true };
  }

  @Post('other')
  other(): { ok: true } {
    return { ok: true };
  }
}

const AUTH_LIMIT = 3;

describe('Rate limiting (integration)', () => {
  let app: INestApplication;
  let redis: Redis;
  const saved = { ...process.env };
  // Every run (and every test) counts under a client of its own, so earlier runs against the same
  // Redis and other suites never share its buckets.
  const aClient = (): string =>
    `10.${String(Math.floor(Math.random() * 250))}.${String(Math.floor(Math.random() * 250))}.${String(1 + Math.floor(Math.random() * 250))}`;

  beforeAll(async () => {
    process.env.THROTTLE_AUTH_LIMIT = String(AUTH_LIMIT);
    process.env.TRUST_PROXY_HOPS = '1';
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), HttpPlatformModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureHttpApp(app, app.get<AppConfig>(APP_CONFIG));
    await app.init();
    redis = app.get(REDIS_CLIENT);
  });

  afterAll(async () => {
    await app.close();
    process.env = saved;
  });

  const call = (path: string, client: string): request.Test =>
    request(app.getHttpServer()).post(`/api/v1/probe/${path}`).set('X-Forwarded-For', client);

  it('should answer 429 with Retry-After when a client exceeds the auth limit on a credential route', async () => {
    const client = aClient();
    for (let attempt = 0; attempt < AUTH_LIMIT; attempt += 1) {
      expect((await call('sign-in', client)).status).toBe(201);
    }

    const blocked = await call('sign-in', client);
    const elsewhere = await call('other', client);
    const otherClient = await call('sign-in', aClient());

    expect(blocked.status).toBe(429);
    expect(blocked.headers['content-type']).toContain('application/problem+json');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(elsewhere.status).toBe(201);
    expect(otherClient.status).toBe(201);
  });

  it('should not count routes without the auth limit against it', async () => {
    const client = aClient();
    for (let attempt = 0; attempt < AUTH_LIMIT + 2; attempt += 1) {
      expect((await call('other', client)).status).toBe(201);
    }

    expect((await call('sign-in', client)).status).toBe(201);
  });

  // Once over the limit the key is blocked for the block duration: further hits are refused
  // without being counted, so a client hammering a blocked route does not extend its own window.
  it('should refuse without counting when the client is already blocked', async () => {
    const storage = new RedisThrottlerStorage(redis);
    const key = `probe-${aClient()}`;
    const hit = () => storage.increment(key, 60_000, 1, 30_000, 'probe');

    const first = await hit();
    const over = await hit();
    const whileBlocked = await hit();

    expect(first).toMatchObject({ totalHits: 1, isBlocked: false, timeToBlockExpire: 0 });
    expect(over).toMatchObject({ totalHits: 2, isBlocked: true, timeToBlockExpire: 30 });
    expect(whileBlocked).toMatchObject({ totalHits: 2, isBlocked: true });
    expect(whileBlocked.timeToBlockExpire).toBeGreaterThan(0);
    expect(whileBlocked.timeToBlockExpire).toBeLessThanOrEqual(30);
    expect(whileBlocked.timeToExpire).toBeGreaterThan(0);
  });
});
