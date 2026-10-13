import { BadRequestException, HttpStatus } from '@nestjs/common';

import { InvalidStateTransitionError } from '@shared/domain';

import { ProblemException, ValidationProblemException } from '../http/problem-details';

import { auditErrorCode } from './audit.interceptor';

describe('auditErrorCode', () => {
  it('should record the code the client saw when the request body failed validation', () => {
    const error = new ValidationProblemException([{ field: 'email', message: 'invalid' }]);

    expect(auditErrorCode(error)).toBe('validation_error');
  });

  it('should record the problem code when a domain, problem or plain http error failed the call', () => {
    expect(
      [
        new InvalidStateTransitionError('Contract', 'draft', 'active'),
        new ProblemException(HttpStatus.CONFLICT, 'idempotency_request_in_progress', 'busy'),
        new BadRequestException('Validation failed (uuid is expected)'),
      ].map(auditErrorCode),
    ).toEqual(['invalid_state_transition', 'idempotency_request_in_progress', 'bad_request']);
  });

  it('should keep the class name when the error was unexpected', () => {
    class QueryFailedError extends Error {
      override name = 'QueryFailedError';
    }

    expect([auditErrorCode(new QueryFailedError('boom')), auditErrorCode('boom')]).toEqual([
      'QueryFailedError',
      'unknown',
    ]);
  });
});
