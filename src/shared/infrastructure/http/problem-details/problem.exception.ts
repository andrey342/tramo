import { HttpException, type HttpStatus } from '@nestjs/common';

import { statusTitle } from './problem-details';

// For errors raised by HTTP infrastructure itself (idempotency, pagination tokens, auth) that
// deserve a stable problem type and code, like domain errors do, but have no place in the domain.
export class ProblemException extends HttpException {
  constructor(
    status: HttpStatus,
    readonly code: string,
    detail: string,
    readonly title: string = statusTitle(status),
  ) {
    super(detail, status);
  }
}
