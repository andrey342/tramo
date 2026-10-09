import { type INestApplication, RequestMethod, VersioningType } from '@nestjs/common';
import helmet from 'helmet';

import { type AppConfig } from '../config';

import { setupSwagger } from './swagger';

export const API_PREFIX = 'api';

// Shared by main.api.ts and the e2e suite so tests exercise the same HTTP pipeline as production.
export function configureHttpApp(app: INestApplication, config: AppConfig): void {
  app.use(helmet());
  app.enableCors({ origin: [...config.http.corsOrigins], credentials: false });
  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
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
