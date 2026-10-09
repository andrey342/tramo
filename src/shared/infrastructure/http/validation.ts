import { ValidationPipe } from '@nestjs/common';

import { ValidationProblemException } from './problem-details';

export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: false },
    exceptionFactory: (errors) => ValidationProblemException.fromValidationErrors(errors),
  });
}
