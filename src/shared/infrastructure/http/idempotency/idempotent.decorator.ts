import { applyDecorators, SetMetadata } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';

export const IDEMPOTENT = Symbol('IDEMPOTENT');
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

// Required on POST endpoints that create applications or move money: a retried request with the
// same key returns the first response instead of acting twice.
export const Idempotent = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(IDEMPOTENT, true),
    ApiHeader({
      name: IDEMPOTENCY_KEY_HEADER,
      required: true,
      description:
        'Client-generated unique key (a UUID is fine). Retries with the same key and body replay ' +
        'the original response for 24 h; the same key with a different body is rejected.',
    }),
  );
