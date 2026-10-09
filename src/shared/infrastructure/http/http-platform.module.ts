import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AuditInterceptor } from '../audit';

import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { ProblemDetailsFilter } from './problem-details';
import { ThrottlingModule } from './throttling/throttling.module';
import { createValidationPipe } from './validation';

// The HTTP pipeline of the api: rate limiting, validation, idempotency, auditing and error
// rendering. The worker does not import it.
@Module({
  imports: [ThrottlingModule],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    // Global interceptors run in registration order, the first one outermost. Idempotency wraps
    // auditing, so a replayed response is not audited as a second execution.
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class HttpPlatformModule {}
