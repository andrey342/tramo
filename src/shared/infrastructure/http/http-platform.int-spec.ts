import { Body, Controller, Inject, type INestApplication, Param, Post } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Throttle } from '@nestjs/throttler';
import { IsInt, Min } from 'class-validator';
import { type NextFunction, type Response } from 'express';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AUDIT_TRAIL, type AuditTrail, type Principal } from '@shared/application';
import { InvalidStateTransitionError } from '@shared/domain';

import { Audited } from '../audit';
import { APP_CONFIG, type AppConfig } from '../config';
import { CoreModule } from '../core.module';

import { configureHttpApp } from './configure-http-app';
import { HttpPlatformModule } from './http-platform.module';
import { Idempotent } from './idempotency/idempotent.decorator';
import { type RequestWithPrincipal } from './principal';

class PaymentDto {
  @IsInt()
  @Min(1)
  amountCents!: number;
}

let paymentsTaken = 0;

@Controller('probe')
class ProbeController {
  constructor(@Inject(AUDIT_TRAIL) private readonly audit: AuditTrail) {}

  @Post('payments')
  @Idempotent()
  async pay(@Body() body: PaymentDto): Promise<{ id: string; amountCents: number }> {
    paymentsTaken += 1;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { id: `payment-${paymentsTaken}`, amountCents: body.amountCents };
  }

  @Post('limited')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  limited(): { ok: true } {
    return { ok: true };
  }

  @Post('centers/:id/suspend')
  @Audited({ action: 'center.suspend', resource: 'center' })
  suspend(@Param('id') id: string): { id: string; status: string } {
    this.audit.describeChanges({ status: { before: 'active', after: 'suspended' } });
    return { id, status: 'suspended' };
  }

  @Post('centers/:id/activate')
  @Audited({ action: 'center.activate', resource: 'center' })
  activate(): never {
    throw new InvalidStateTransitionError('TrainingCenter', 'suspended', 'active');
  }
}

const OPS_USER: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

describe('HTTP platform (integration)', () => {
  let app: INestApplication;
  let db: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), HttpPlatformModule],
      controllers: [ProbeController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    // Stands in for the iam guards: the caller is whoever the test header names.
    app.use((req: RequestWithPrincipal, _res: Response, next: NextFunction) => {
      const user = req.header('x-test-user');
      if (user) {
        req.principal = { ...OPS_USER, userId: user };
      }
      next();
    });
    configureHttpApp(app, app.get<AppConfig>(APP_CONFIG));
    await app.init();
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  const pay = (key: string | undefined, amountCents = 1000, user = 'student-1'): request.Test => {
    const call = request(app.getHttpServer())
      .post('/api/v1/probe/payments')
      .set('x-test-user', user)
      .send({ amountCents });
    return key === undefined ? call : call.set('Idempotency-Key', key);
  };

  describe('idempotency', () => {
    it('should require the Idempotency-Key header', async () => {
      const response = await pay(undefined);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('idempotency_key_missing');
    });

    it('should replay the first response for a retry with the same key and body', async () => {
      const before = paymentsTaken;
      const first = await pay('key-replay');
      const retry = await pay('key-replay');

      expect(first.status).toBe(201);
      expect(retry.status).toBe(201);
      expect(retry.body).toEqual(first.body);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(paymentsTaken - before).toBe(1);
    });

    it('should reject the same key with a different body', async () => {
      await pay('key-reused', 1000);
      const response = await pay('key-reused', 2000);

      expect(response.status).toBe(422);
      expect(response.body.type).toBe('urn:tramo:problem:idempotency-key-reused');
    });

    it('should answer 409 to a concurrent request while the first is still running', async () => {
      const [a, b] = await Promise.all([pay('key-concurrent'), pay('key-concurrent')]);

      expect([a.status, b.status].sort()).toEqual([201, 409]);
    });

    it('should scope keys to the caller', async () => {
      const before = paymentsTaken;
      await pay('key-shared', 1000, 'student-1');
      await pay('key-shared', 1000, 'student-2');

      expect(paymentsTaken - before).toBe(2);
    });

    it('should not keep the key when the request fails validation', async () => {
      const invalid = await pay('key-after-error', 0);
      const valid = await pay('key-after-error', 1000);

      expect(invalid.status).toBe(400);
      expect(valid.status).toBe(201);
    });
  });

  describe('rate limiting', () => {
    it('should answer 429 with Retry-After once the route limit is exceeded', async () => {
      const call = (): request.Test => request(app.getHttpServer()).post('/api/v1/probe/limited');
      for (let attempt = 0; attempt < 3; attempt += 1) {
        expect((await call()).status).toBe(201);
      }

      const blocked = await call();

      expect(blocked.status).toBe(429);
      expect(blocked.headers['content-type']).toContain('application/problem+json');
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('audit log', () => {
    const entriesFor = (resourceId: string): Promise<Record<string, unknown>[]> =>
      db.query(
        `SELECT actor_type, actor_id, action, resource_type, outcome, error_code, request_id, changes, metadata
           FROM shared.audit_log WHERE resource_id = $1`,
        [resourceId],
      );

    it('should record who changed what, with the changes the handler described', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/probe/centers/center-1/suspend')
        .set('x-test-user', 'ops-7')
        .set('x-request-id', 'req-audit-1');

      expect(response.status).toBe(201);
      expect(await entriesFor('center-1')).toEqual([
        {
          actor_type: 'user',
          actor_id: 'ops-7',
          action: 'center.suspend',
          resource_type: 'center',
          outcome: 'succeeded',
          error_code: null,
          request_id: 'req-audit-1',
          changes: { status: { before: 'active', after: 'suspended' } },
          metadata: { method: 'POST', path: '/api/v1/probe/centers/center-1/suspend' },
        },
      ]);
    });

    it('should record failed attempts with the error code', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/probe/centers/center-2/activate')
        .set('x-test-user', 'ops-7');

      expect(response.status).toBe(409);
      expect(await entriesFor('center-2')).toEqual([
        expect.objectContaining({ outcome: 'failed', error_code: 'invalid_state_transition' }),
      ]);
    });
  });
});
