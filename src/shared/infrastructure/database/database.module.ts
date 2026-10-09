import { type DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { APP_CONFIG, type AppConfig } from '../config';

import { typeOrmOptions } from './typeorm-options';

@Module({})
export class DatabaseModule {
  static forRoot(applicationName: string): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({
            ...typeOrmOptions(config, applicationName),
            autoLoadEntities: true,
            // Logs are buffered until bootstrap finishes, so keep the silent retry window short
            // (~10 s) and let the orchestrator restart the process if the database stays away.
            retryAttempts: 5,
            retryDelay: 2000,
          }),
        }),
      ],
    };
  }
}
