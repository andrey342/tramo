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
          }),
        }),
      ],
    };
  }
}
