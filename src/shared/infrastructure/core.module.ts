import { type DynamicModule, Module } from '@nestjs/common';

import { ConfigModule } from './config';
import { RequestContextModule } from './context';
import { DatabaseModule } from './database';
import { HealthModule } from './health';
import { LoggingModule } from './logging';
import { MessagingModule } from './messaging';
import { RedisModule } from './redis';

// Runtime shared by the api and the worker; only the application name differs.
@Module({})
export class CoreModule {
  static forRoot(options: { applicationName: string }): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        ConfigModule,
        RequestContextModule,
        LoggingModule,
        DatabaseModule.forRoot(options.applicationName),
        MessagingModule,
        RedisModule,
        HealthModule,
      ],
    };
  }
}
