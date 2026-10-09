import { type INestApplication } from '@nestjs/common';
import { HealthIndicatorService, TerminusModule, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { HttpPlatformModule } from '../http';

import { HealthController } from './health.controller';
import { RedisHealthIndicator } from './redis.health';

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TerminusModule.forRoot({ logger: false }), HttpPlatformModule],
      controllers: [HealthController],
      providers: [
        {
          provide: TypeOrmHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (indicators: HealthIndicatorService) => ({
            pingCheck: (key: string) => ({ withTimeout: () => indicators.check(key).up() }),
          }),
        },
        {
          provide: RedisHealthIndicator,
          inject: [HealthIndicatorService],
          useFactory: (indicators: HealthIndicatorService) => ({
            ping: (key: string) => indicators.check(key).down({ message: 'connect ECONNREFUSED' }),
          }),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should answer 503 with the failing dependency when a readiness check is down', async () => {
    const response = await request(app.getHttpServer()).get('/health/ready');

    expect(response.status).toBe(503);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).toMatchObject({
      status: 'error',
      info: { database: { status: 'up' } },
      error: { redis: { status: 'down', message: 'connect ECONNREFUSED' } },
    });
  });
});
