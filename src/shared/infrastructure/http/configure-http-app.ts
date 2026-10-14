import { HttpStatus, type INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import { type Express, type Request, type Response } from 'express';
import helmet from 'helmet';

import { type AppConfig } from '../config';
import { resolveRequestId } from '../context/request-id';

import {
  PROBLEM_CONTENT_TYPE,
  type ProblemDetails,
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
    const status = HttpStatus.NOT_FOUND;
    const problem: ProblemDetails = {
      type: 'about:blank',
      title: statusTitle(status),
      status,
      detail: `No route matches ${request.method} ${path}.`,
      code: statusCode(status),
      instance: path,
      requestId: resolveRequestId(request, response),
    };
    response.status(status).type(PROBLEM_CONTENT_TYPE).json(problem);
  });
}
