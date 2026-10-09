import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { type Request, type Response } from 'express';

import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemType,
  statusTitle,
} from './problem-details';
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
      instance: request.originalUrl,
      requestId: typeof request.id === 'string' ? request.id : undefined,
    };

    if (problem.status >= 500) {
      this.logger.error({ err: exception, requestId: problem.requestId }, 'Unhandled exception');
    }

    response.status(problem.status).type(PROBLEM_CONTENT_TYPE).json(problem);
  }

  private toProblem(exception: unknown): ProblemDetails {
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
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        type: 'about:blank',
        title: statusTitle(status),
        status,
        detail: httpExceptionDetail(exception),
      };
    }
    return {
      type: 'about:blank',
      title: statusTitle(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      detail: 'An unexpected error occurred.',
    };
  }
}

function httpExceptionDetail(exception: HttpException): string | undefined {
  const body = exception.getResponse();
  if (typeof body === 'string') {
    return body;
  }
  const message = (body as { message?: unknown }).message;
  if (typeof message === 'string') {
    return message;
  }
  if (Array.isArray(message)) {
    return message.filter((item): item is string => typeof item === 'string').join('; ');
  }
  return undefined;
}
