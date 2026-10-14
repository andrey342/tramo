import { type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, type ThrottlerStorage } from '@nestjs/throttler';

import { AUTH_THROTTLER, RetryAfterThrottlerGuard } from './throttling.module';

class ProbeController {
  signIn(): void {
    return undefined;
  }
}

describe('RetryAfterThrottlerGuard', () => {
  // The guard alone would name it Retry-After-auth, which no client reads.
  it('should send Retry-After when a named throttler other than default refuses the request', async () => {
    const storage: ThrottlerStorage = {
      increment: () =>
        Promise.resolve({ totalHits: 4, timeToExpire: 50, isBlocked: true, timeToBlockExpire: 42 }),
    };
    const guard = new RetryAfterThrottlerGuard(
      { throttlers: [{ name: AUTH_THROTTLER, ttl: 60_000, limit: 3 }] },
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
    const headers = new Map<string, unknown>();
    const response = {
      header: (name: string, value: unknown) => headers.set(name, value),
      removeHeader: (name: string) => headers.delete(name),
    };
    const context = {
      getHandler: () => ProbeController.prototype.signIn,
      getClass: () => ProbeController,
      switchToHttp: () => ({
        getRequest: () => ({ ip: '10.0.0.1', headers: {} }),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).rejects.toThrow(ThrottlerException);
    expect(headers.get('Retry-After')).toBe(42);
    expect(headers.get('X-RateLimit-Limit')).toBe(3);
    expect(headers.get('X-RateLimit-Remaining')).toBe(0);
    expect(headers.has('Retry-After-auth')).toBe(false);
  });
});
