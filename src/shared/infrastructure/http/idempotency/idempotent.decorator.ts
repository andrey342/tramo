import { applyDecorators, HttpStatus, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

import { ApiProblems } from '../problem-details/api-problems.decorator';

export const IDEMPOTENT = Symbol('IDEMPOTENT');
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

// What IdempotencyInterceptor itself answers, documented with the route so the OpenAPI document
// cannot drift from it: 400 for a missing or malformed key, 409 while the first request with the
// key runs, 422 for the key reused with another request, 503 when the store cannot be reached.
export const IDEMPOTENCY_STATUSES = [
  HttpStatus.BAD_REQUEST,
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
  HttpStatus.SERVICE_UNAVAILABLE,
] as const;

// Required on POST endpoints that create applications or move money: a retried request with the
// same key returns the first response instead of acting twice.
export const Idempotent = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    ApiProblems(...IDEMPOTENCY_STATUSES),
    ApiHeader({
      name: IDEMPOTENCY_KEY_HEADER,
      required: true,
      description:
        'Client-generated unique key (a UUID is fine). Retries with the same key and body replay ' +
        'the original response for 24 h; the same key with a different body is rejected.',
    }),
  );
