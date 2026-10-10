import { type DynamicModule, Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';

import { AuditModule } from './audit';
import { ClockModule } from './clock/system-clock';
import { ConfigModule } from './config';
import { RequestContextModule } from './context';
import { CryptoModule } from './crypto';
import { DatabaseModule } from './database';
import { HealthModule } from './health';
import { LoggingModule } from './logging';
import { MessagingModule } from './messaging';
import { QueuesModule } from './queues';
import { RedisModule } from './redis';

// Runtime shared by the api and the worker; only the application name differs.
@Module({})
export class CoreModule {
  static forRoot(options: { applicationName: string }): DynamicModule {
    return {
      module: CoreModule,
      imports: [
        ConfigModule,
        ClockModule,
        CryptoModule,
        // Command, query and event buses for every module; handlers are discovered globally.
        CqrsModule.forRoot(),
        RequestContextModule,
        LoggingModule,
        DatabaseModule.forRoot(options.applicationName),
        MessagingModule,
        // The AuditTrail port is available to use cases in both processes; only the api's HTTP
        // pipeline writes audit entries.
        AuditModule,
        RedisModule,
        QueuesModule,
        HealthModule,
      ],
    };
  }
}
