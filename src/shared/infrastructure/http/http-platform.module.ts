import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';

import { AuditModule } from '../audit';

import { IdempotencyInterceptor } from './idempotency/idempotency.interceptor';
import { ProblemDetailsFilter } from './problem-details';
import { ThrottlingModule } from './throttling/throttling.module';
import { createValidationPipe } from './validation';

// The HTTP pipeline of the api: rate limiting, validation, idempotency, auditing and error
// rendering. The worker does not import it.
@Module({
  imports: [ThrottlingModule, AuditModule],
  providers: [
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
})
export class HttpPlatformModule {}
