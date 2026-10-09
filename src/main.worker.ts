import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.worker.healthPort);
}

void bootstrap();
