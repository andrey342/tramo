import { type ExecutionContext, type Type } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerException, ThrottlerGuard, ThrottlerStorageService } from '@nestjs/throttler';

// Sends `calls` requests from one client to one route through the global rate limiter, set to a
// single request per minute, and counts how many it lets through. Without Redis or HTTP: the
// guard reads the route's metadata exactly as it does in the api.
export async function requestsLetThrough(
  controller: Type,
  handler: string,
  calls: number,
): Promise<number> {
  const storage = new ThrottlerStorageService();
  const guard = new ThrottlerGuard(
    { throttlers: [{ name: 'default', ttl: 60_000, limit: 1 }] },
    storage,
    new Reflector(),
  );
  await guard.onModuleInit();
  const request = { ip: '203.0.113.7', headers: {} };
  const response = { header: () => undefined };
  const context = {
    getHandler: () => (controller.prototype as Record<string, unknown>)[handler],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }),
  } as unknown as ExecutionContext;

  let passed = 0;
  try {
    for (let call = 0; call < calls; call += 1) {
      try {
        if (await guard.canActivate(context)) {
          passed += 1;
        }
      } catch (error) {
        if (!(error instanceof ThrottlerException)) {
          throw error;
        }
      }
    }
  } finally {
    storage.onApplicationShutdown();
  }
  return passed;
}
