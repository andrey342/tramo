import { randomBytes } from 'node:crypto';

import { type CallHandler, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Redis } from 'ioredis';
import { lastValueFrom, of } from 'rxjs';

import { type Principal } from '@shared/application';

import { type AppConfig } from '../../config';
import { FieldCipher } from '../../crypto';

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IDEMPOTENT } from './idempotent.decorator';

// Only the commands the interceptor uses, kept in a map; the real store is covered by
// http-platform.int-spec.ts.
class MapRedis {
  readonly values = new Map<string, string>();

  get(key: string): Promise<string | null> {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  set(key: string, value: string, ...options: unknown[]): Promise<'OK' | null> {
    if (options.includes('NX') && this.values.has(key)) {
      return Promise.resolve(null);
    }
    this.values.set(key, value);
    return Promise.resolve('OK');
  }

  del(key: string): Promise<number> {
    return Promise.resolve(this.values.delete(key) ? 1 : 0);
  }

  pexpire(): Promise<number> {
    return Promise.resolve(1);
  }
}

class ProbeController {
  createApplication(): void {
    // Only its metadata is read.
  }
}
Reflect.defineMetadata(IDEMPOTENT, true, ProbeController.prototype.createApplication);

const STUDENT: Principal = {
  kind: 'user',
  userId: 'student-1',
  roles: ['student'],
  centerId: null,
};
const PROFILE = {
  id: 'application-1',
  nationalId: '56781234F',
  declaredMonthlyIncomeCents: 180000,
};

describe('IdempotencyInterceptor', () => {
  const redis = new MapRedis();
  const interceptor = new IdempotencyInterceptor(
    new Reflector(),
    redis as unknown as Redis,
    new FieldCipher({
      crypto: { fieldEncryptionKey: randomBytes(32).toString('base64') },
    } as AppConfig),
  );

  function call(
    key: string,
    handler: () => unknown,
  ): Promise<{ body: unknown; replayed: boolean }> {
    const headers: Record<string, string> = {};
    const request = {
      method: 'POST',
      originalUrl: '/api/v1/applications',
      body: { programId: 'program-1' },
      principal: STUDENT,
      header: (name: string) => (name.toLowerCase() === 'idempotency-key' ? key : undefined),
    };
    const response = {
      statusCode: 201,
      status: (code: number) => {
        response.statusCode = code;
      },
      getHeader: () => undefined,
      setHeader: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      },
    };
    const context = {
      getHandler: () => ProbeController.prototype.createApplication,
      getClass: () => ProbeController,
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of(handler()) };
    return interceptor
      .intercept(context, next)
      .then((observable) => lastValueFrom(observable))
      .then((body) => ({ body, replayed: headers['idempotent-replayed'] === 'true' }));
  }

  it('should keep the stored response unreadable and replay it decrypted when the key comes back', async () => {
    const first = await call('key-1', () => PROFILE);
    const retry = await call('key-1', () => {
      throw new Error('the handler must not run twice');
    });

    const stored = [...redis.values.values()].join('\n');
    expect(stored).toContain('"state":"completed"');
    expect(stored).not.toContain('56781234F');
    expect(first).toEqual({ body: PROFILE, replayed: false });
    expect(retry).toEqual({ body: PROFILE, replayed: true });
  });

  it('should replay a response stored in clear before bodies were encrypted', async () => {
    redis.values.clear();
    await call('key-2', () => ({ id: 'application-2' }));
    const [storageKey, raw] = [...redis.values.entries()].find(([, value]) =>
      value.includes('sealedBody'),
    ) as [string, string];
    const { sealedBody: _sealed, ...record } = JSON.parse(raw) as Record<string, unknown>;
    redis.values.set(storageKey, JSON.stringify({ ...record, body: { id: 'application-2' } }));

    const retry = await call('key-2', () => {
      throw new Error('the handler must not run twice');
    });

    expect(retry).toEqual({ body: { id: 'application-2' }, replayed: true });
  });
});
