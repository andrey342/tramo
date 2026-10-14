import { BadRequestException, type ValidationError } from '@nestjs/common';

import { type FieldError } from './problem-details';

export class ValidationProblemException extends BadRequestException {
  readonly code = 'validation_error';

  constructor(readonly errors: readonly FieldError[]) {
    super('The request contains invalid fields.');
  }

  static fromValidationErrors(errors: ValidationError[]): ValidationProblemException {
    return new ValidationProblemException(flatten(errors, ''));
  }
}

// A field that is missing gets one message saying so, not every rule its absent value breaks
// (length, format, type).
function flatten(errors: ValidationError[], parent: string): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const constraints = Object.values(error.constraints ?? {});
    const own =
      error.value === undefined && constraints.length > 0
        ? [{ field, message: `${field} is required` }]
        : constraints.map((message) => ({ field, message }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}
