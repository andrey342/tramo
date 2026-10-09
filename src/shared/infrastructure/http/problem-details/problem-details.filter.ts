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

import { domainErrorToProblem } from './domain-error.mapper';
import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemType,
  statusTitle,
} from './problem-details';
import { ProblemException } from './problem.exception';
import { ValidationProblemException } from './validation-problem.exception';

type RequestWithId = Request & { id?: unknown };

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    const problem: ProblemDetails = {
      ...this.toProblem(exception),
      // Path only: the query string may carry identifiers that should not be echoed back.
      instance: request.originalUrl.split('?', 1)[0],
      requestId: typeof request.id === 'string' ? request.id : undefined,
    };

    if (!(exception instanceof HttpException || exception instanceof DomainError)) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Unhandled exception');
    } else if (problem.status >= 500) {
      this.logger.warn({ requestId: problem.requestId, detail: problem.detail }, problem.title);
    }

    const retryAfter =
      exception instanceof DomainError ? exception.details?.retryAfterSeconds : undefined;
    if (typeof retryAfter === 'number') {
      response.setHeader('Retry-After', String(retryAfter));
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
        code: 'validation_error',
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
      return { type: 'about:blank', title, status, detail: detail === title ? undefined : detail };
    }
    return {
      type: 'about:blank',
      title: statusTitle(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
    };
  }
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
