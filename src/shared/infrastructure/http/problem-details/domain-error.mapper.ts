import { HttpStatus } from '@nestjs/common';

import { type DomainError, type DomainErrorCategory, InvalidValueError } from '@shared/domain';

import { type ProblemDetails, problemType } from './problem-details';

const STATUS_BY_CATEGORY: Record<DomainErrorCategory, HttpStatus> = {
  validation: HttpStatus.UNPROCESSABLE_ENTITY,
  rule_violation: HttpStatus.UNPROCESSABLE_ENTITY,
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  unauthorized: HttpStatus.UNAUTHORIZED,
  forbidden: HttpStatus.FORBIDDEN,
  rate_limited: HttpStatus.TOO_MANY_REQUESTS,
};

// invalid_state_transition -> "Invalid state transition"
function titleFromCode(code: string): string {
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function domainErrorToProblem(error: DomainError): ProblemDetails {
  return {
    type: problemType(error.code.replace(/_/g, '-')),
    title: titleFromCode(error.code),
    status: STATUS_BY_CATEGORY[error.category],
    detail: error.message,
    code: error.code,
    errors:
      error instanceof InvalidValueError
        ? [{ field: error.field, message: error.message }]
        : undefined,
  };
}
