import { HttpException, type HttpStatus } from '@nestjs/common';

import { titleFromCode } from './domain-error.mapper';

// For errors raised by HTTP infrastructure itself (idempotency, pagination tokens, auth) that
// deserve a stable problem type and code, like domain errors do, but have no place in the domain.
// The title reads the code, as for domain errors. `retryAfterSeconds` becomes a Retry-After header
// (a 503 the client should retry).
export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus | number,
    readonly code: string,
    detail: string,
    readonly title: string = titleFromCode(code),
    readonly retryAfterSeconds?: number,
  ) {
    super(detail, status);
  }
}
