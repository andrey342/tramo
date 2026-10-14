import {
  type ArgumentMetadata,
  Injectable,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import { isUUID } from 'class-validator';

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

// Ids in the path are UUIDs. A malformed one is a validation error naming the parameter, like any
// other invalid field.
@Injectable()
export class ParseIdPipe implements PipeTransform<string, string> {
  transform(value: string, metadata: ArgumentMetadata): string {
    if (!isUUID(value)) {
      const field = metadata.data ?? 'id';
      throw new ValidationProblemException([{ field, message: `${field} must be a UUID` }]);
    }
    return value;
  }
}
