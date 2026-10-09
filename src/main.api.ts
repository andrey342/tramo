import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.http.port);
}

void bootstrap();
