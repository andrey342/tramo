import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import {
  answerUnknownPaths,
  configureHttpApp,
  ProblemExpressAdapter,
} from '@shared/infrastructure/http';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, new ProblemExpressAdapter(), {
    bufferLogs: true,
    // Signed webhooks are verified over the exact bytes received.
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  const config = app.get<AppConfig>(APP_CONFIG);
  configureHttpApp(app, config);
  await app.init();
  answerUnknownPaths(app);
  await app.listen(config.http.port);
}

void bootstrap();
