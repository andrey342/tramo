import { BadRequestException, type ValidationError } from '@nestjs/common';

import { type FieldError } from './problem-details';

export class ValidationProblemException extends BadRequestException {
  constructor(readonly errors: readonly FieldError[]) {
    super('The request contains invalid fields.');
  }

  static fromValidationErrors(errors: ValidationError[]): ValidationProblemException {
    return new ValidationProblemException(flatten(errors, ''));
  }
}

function flatten(errors: ValidationError[], parent: string): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.values(error.constraints ?? {}).map((message) => ({ field, message }));
    return [...own, ...flatten(error.children ?? [], field)];
  });
}
