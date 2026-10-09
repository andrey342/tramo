import { type Provider } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { ProblemDetailsFilter } from './problem-details';
import { createValidationPipe } from './validation';

// Error rendering and validation exactly as in the api, without Redis or the database, for unit
// tests of controllers.
export const httpErrorHandlingProviders: Provider[] = [
  { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  { provide: APP_PIPE, useFactory: createValidationPipe },
];
