import { HttpStatus } from '@nestjs/common';
import { ExpressAdapter } from '@nestjs/platform-express';

import { ProblemException } from './problem-details';

// Nest turns a body the JSON parser refused into a 400 carrying the parser's own message. This
// adapter gives it a code and a plain detail instead, like every other problem.
export class ProblemExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    if (
      error instanceof SyntaxError &&
      (error as { type?: unknown }).type === 'entity.parse.failed'
    ) {
      return new ProblemException(
        HttpStatus.BAD_REQUEST,
        'malformed_body',
        'The request body is not valid JSON.',
      );
    }
    return super.mapException(error);
  }
}
