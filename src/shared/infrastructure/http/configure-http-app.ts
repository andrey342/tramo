import { HttpStatus, type INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';

import { type AppConfig } from '../config';
import { resolveRequestId } from '../context/request-id';

import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
  problemType,
  statusCode,
  statusTitle,
} from './problem-details';
import { setupSwagger } from './swagger';

export const API_PREFIX = 'api';

// Shared by main.api.ts and the e2e suite so tests exercise the same HTTP pipeline as production.
export function configureHttpApp(app: INestApplication, config: AppConfig): void {
  if (config.http.trustProxyHops > 0) {
    // Express then derives req.ip from X-Forwarded-For, skipping exactly that many proxies.
    (app.getHttpAdapter().getInstance() as { set(key: string, value: unknown): void }).set(
      'trust proxy',
      config.http.trustProxyHops,
    );
  }
  app.use(helmet());
  app.enableCors({ origin: [...config.http.corsOrigins], credentials: false });
  app.use(`/${API_PREFIX}`, refuseBodiesThatAreNotJson);
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
      // Bull Board mounts its own router and assets below this path.
      'admin/queues',
      'admin/queues/{*path}',
    ],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableShutdownHooks();
  if (config.docs.enabled) {
    setupSwagger(app);
  }
}

// Nest answers unknown paths only below the global prefix; any other path would get Express's
// HTML page. Call it once the app is initialised, so it runs after every route.
export function answerUnknownPaths(app: INestApplication): void {
  (app.getHttpAdapter().getInstance() as Express).use((request: Request, response: Response) => {
    const path = request.originalUrl.split('?', 1)[0] ?? '/';
    sendProblem(
      request,
      response,
      HttpStatus.NOT_FOUND,
      `No route matches ${request.method} ${path}.`,
    );
  });
}

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// The api reads JSON only. A body of another type (a form, plain text) is refused before anything
// parses it, instead of being read as a form or silently taken as empty.
function refuseBodiesThatAreNotJson(request: Request, response: Response, next: () => void): void {
  const hasBody =
    Number(request.headers['content-length'] ?? 0) > 0 ||
    request.headers['transfer-encoding'] !== undefined;
  if (
    !BODY_METHODS.has(request.method) ||
    !hasBody ||
    request.is(['application/json', 'application/*+json'])
  ) {
    next();
    return;
  }
  sendProblem(
    request,
    response,
    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
    'The request body must be JSON (Content-Type: application/json).',
    'unsupported_media_type',
  );
}

function sendProblem(
  request: Request,
  response: Response,
  status: HttpStatus,
  detail: string,
  code: string = statusCode(status),
): void {
  const path = request.originalUrl.split('?', 1)[0] ?? '/';
  const problem: ProblemDetails = {
    type: problemType(code.replace(/_/g, '-')),
    title: statusTitle(status),
    status,
    detail,
    code,
    instance: path,
    requestId: resolveRequestId(request, response),
  };
  response.status(status).type(PROBLEM_CONTENT_TYPE).json(problem);
}
