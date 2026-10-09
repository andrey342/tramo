import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthModule } from './health';
import { LoggingModule } from './logging';
import { RedisModule } from './redis';

// Runtime shared by the api and the worker; only the application name differs.
@Module({})
export class CoreModule {
  static forRoot(options: { applicationName: string }): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        ConfigModule,
        LoggingModule,
        DatabaseModule.forRoot(options.applicationName),
        RedisModule,
        HealthModule,
      ],
    };
  }
}
