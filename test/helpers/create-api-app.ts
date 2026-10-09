import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { configureHttpApp } from '@shared/infrastructure/http';

import { AppModule } from '../../src/app.module';

export async function createApiApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureHttpApp(app, app.get<AppConfig>(APP_CONFIG));
  await app.init();
  return app;
}
