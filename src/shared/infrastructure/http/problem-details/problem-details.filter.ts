import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

import { DomainError } from '@shared/domain';

import { resolveRequestId } from '../../context/request-id';

import { domainErrorToProblem } from './domain-error.mapper';
import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemType,
  statusCode,
  statusTitle,
} from './problem-details';
import { ProblemException } from './problem.exception';
import { ValidationProblemException } from './validation-problem.exception';

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const problem: ProblemDetails = {
      ...this.toProblem(exception),
      // Path only: the query string may carry identifiers that should not be echoed back.
      instance: request.originalUrl.split('?', 1)[0],
      // Set by the request context; a body the parser refused fails before it, so it is resolved
      // here too.
      requestId: resolveRequestId(request, response),
    };

    if (problem.code === DATABASE_UNAVAILABLE) {
      this.logger.warn(
        { requestId: problem.requestId, err: errorMessage(exception) },
        'Database unreachable; request refused',
      );
    } else if (!(exception instanceof HttpException || exception instanceof DomainError)) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Unhandled exception');
    } else if (problem.status >= 500) {
      this.logger.warn({ requestId: problem.requestId, detail: problem.detail }, problem.title);
    }

    const retryAfter =
      exception instanceof DomainError
        ? exception.details?.retryAfterSeconds
        : exception instanceof ProblemException
          ? exception.retryAfterSeconds
          : problem.code === DATABASE_UNAVAILABLE
            ? DATABASE_RETRY_AFTER_SECONDS
            : undefined;
    if (typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
    }
    // RFC 9110 wants a challenge on every 401. The guards set theirs; a 401 from a use case (wrong
    // password, refresh token no longer valid) answers with the scheme the api's sessions use.
    if (
      exception instanceof DomainError &&
      problem.status === 401 &&
      !response.hasHeader('WWW-Authenticate')
    ) {
      response.setHeader('WWW-Authenticate', 'Bearer');
    }
    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
    if (exception instanceof DomainError) {
      return domainErrorToProblem(exception);
    }
    if (exception instanceof ValidationProblemException) {
      return {
        type: problemType('validation-error'),
        title: 'Validation failed',
        status: HttpStatus.BAD_REQUEST,
        detail: exception.message,
        code: exception.code,
        errors: exception.errors,
      };
    }
    if (exception instanceof ProblemException) {
      return {
        type: problemType(exception.code.replace(/_/g, '-')),
        title: exception.title,
        status: exception.getStatus(),
        detail: exception.message,
        code: exception.code,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const title = statusTitle(status);
      const detail = httpExceptionDetail(exception);
      // RFC 9457: detail explains this occurrence; a copy of the title adds nothing.
      // Every problem names its type after its code, framework errors included.
      return {
        type: problemType(statusCode(status).replace(/_/g, '-')),
        title,
        status,
        detail: detail === title ? undefined : detail,
        code: statusCode(status),
      };
    }
    if (isDatabaseUnavailable(exception)) {
      return {
        type: problemType('database-unavailable'),
        title: 'Database unavailable',
        status: HttpStatus.SERVICE_UNAVAILABLE,
        detail: 'The database cannot be reached right now. Try again shortly.',
        code: DATABASE_UNAVAILABLE,
      };
    }
    return {
      type: problemType('internal-server-error'),
      title: statusTitle(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
      code: statusCode(HttpStatus.INTERNAL_SERVER_ERROR),
    };
  }
}

const DATABASE_UNAVAILABLE = 'database_unavailable';
const DATABASE_RETRY_AFTER_SECONDS = 5;
// Postgres unreachable (refused, unknown host, timed out, dropped) or shutting down / starting up
// (SQLSTATE class 08 and 57P0x): the request did not fail on its own, so the client may retry.
const UNREACHABLE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  '57P01',
  '57P02',
  '57P03',
  '08000',
  '08001',
  '08003',
  '08006',
]);
const UNREACHABLE_MESSAGE =
  /Connection terminated|timeout exceeded when trying to connect|Connection refused/i;

function isDatabaseUnavailable(exception: unknown): boolean {
  let current: unknown = exception;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const { code, message, driverError, cause } = current as {
      code?: unknown;
      message?: unknown;
      driverError?: unknown;
      cause?: unknown;
    };
    if (typeof code === 'string' && UNREACHABLE_CODES.has(code)) return true;
    if (typeof message === 'string' && UNREACHABLE_MESSAGE.test(message)) return true;
    current = driverError ?? cause;
  }
  return false;
}

function errorMessage(exception: unknown): string {
  return exception instanceof Error ? exception.message : String(exception);
}

// Nest's router answers unknown routes with "Cannot GET /path?query"; keep the method and path.
const ROUTE_NOT_FOUND = /^Cannot (\w+) ([^?\s]*)/;

function httpExceptionDetail(exception: HttpException): string | undefined {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') {
    const route = ROUTE_NOT_FOUND.exec(message);
    return route ? `No route matches ${route[1] ?? ''} ${route[2] ?? ''}.` : message;
  }
  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === 'string').join('; ');
  }
  return undefined;
}
