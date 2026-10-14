import { ExpressAdapter } from '@nestjs/platform-express';

import { ProblemException, statusCode } from './problem-details';

// What the body parser says about a body it refused (its errors carry `type`, `status` and
// `expose`), as a problem with a stable code and a plain detail.
const BODY_PROBLEMS: Readonly<Record<string, { readonly code: string; readonly detail: string }>> =
  {
    'entity.parse.failed': {
      code: 'malformed_body',
      detail: 'The request body is not valid JSON.',
    },
    'entity.too.large': {
      code: 'payload_too_large',
      detail: 'The request body is too large.',
    },
    'charset.unsupported': {
      code: 'unsupported_media_type',
      detail: 'The request body uses a charset that is not supported.',
    },
    'encoding.unsupported': {
      code: 'unsupported_media_type',
      detail: 'The request body uses a content encoding that is not supported.',
    },
  };

interface BodyParserError {
  readonly type?: unknown;
  readonly status?: unknown;
  readonly expose?: unknown;
}

// Nest turns a body the JSON parser refused into a 400 carrying the parser's own message, and
// leaves the parser's other client errors (too large, unsupported charset or encoding) to become
// 500s. This adapter answers them all as problems with their own status.
export class ProblemExpressAdapter extends ExpressAdapter {
  override mapException(error: unknown): unknown {
    const parser = (typeof error === 'object' && error !== null ? error : {}) as BodyParserError;
    const status = typeof parser.status === 'number' ? parser.status : null;
    if (parser.expose === true && status !== null && status >= 400 && status < 500) {
      const known = typeof parser.type === 'string' ? BODY_PROBLEMS[parser.type] : undefined;
      return new ProblemException(
        status,
        known?.code ?? statusCode(status),
        known?.detail ?? 'The request body could not be read.',
      );
    }
    return super.mapException(error);
  }
}
