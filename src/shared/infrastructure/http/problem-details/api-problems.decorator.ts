import { applyDecorators } from '@nestjs/common';
import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  ApiResponse,
  getSchemaPath,
} from '@nestjs/swagger';

import { PROBLEM_CONTENT_TYPE, statusTitle } from './problem-details';

class FieldErrorSchema {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'email must be an email' })
  message!: string;
}

// OpenAPI shape of every error response (RFC 9457 plus the `code` and `requestId` extensions).
export class ProblemDetailsSchema {
  @ApiProperty({ example: 'urn:tramo:problem:validation-error' })
  type!: string;

  @ApiProperty({ example: 'Validation failed' })
  title!: string;

  @ApiProperty({ example: 400 })
  status!: number;

  @ApiProperty({ example: 'validation_error', description: 'Stable identifier to branch on.' })
  code!: string;

  @ApiPropertyOptional({ example: 'The request contains invalid fields.' })
  detail?: string;

  @ApiPropertyOptional({ example: '/api/v1/auth/register' })
  instance?: string;

  @ApiPropertyOptional({ example: '01a1273c-919e-7cc7-b648-a5a2a670c014' })
  requestId?: string;

  @ApiPropertyOptional({ type: [FieldErrorSchema] })
  errors?: FieldErrorSchema[];
}

// Documents the error statuses a route can answer, all as application/problem+json.
//   @ApiProblems(400, 401, 409)
export function ApiProblems(...statuses: number[]): MethodDecorator & ClassDecorator {
  return applyDecorators(
    ApiExtraModels(ProblemDetailsSchema),
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: statusTitle(status),
        content: {
          [PROBLEM_CONTENT_TYPE]: { schema: { $ref: getSchemaPath(ProblemDetailsSchema) } },
        },
      }),
    ),
  );
}
