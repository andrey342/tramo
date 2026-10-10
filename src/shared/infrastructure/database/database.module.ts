import { type DynamicModule, Global, Module } from '@nestjs/common';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { ClsPluginTransactional } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsModule } from 'nestjs-cls';
import { DataSource } from 'typeorm';

import { UNIT_OF_WORK } from '@shared/application';

import { APP_CONFIG, type AppConfig } from '../config';

import { ClsUnitOfWork } from './cls-unit-of-work';
import { runMigrationsExclusively } from './run-migrations';
import { typeOrmOptions } from './typeorm-options';

@Global()
@Module({})
export class DatabaseModule {
  static forRoot(applicationName: string): DynamicModule {
    return {
      module: DatabaseModule,
      imports: [
        TypeOrmModule.forRootAsync({
          inject: [APP_CONFIG],
          useFactory: (config: AppConfig) => ({
            ...typeOrmOptions(config.database, applicationName),
            autoLoadEntities: true,
            // Logs are buffered until bootstrap finishes, so keep the silent retry window short
            // (~10 s) and let the orchestrator restart the process if the database stays away.
            retryAttempts: 5,
            retryDelay: 2000,
          }),
          dataSourceFactory: async (options) => {
            if (!options) {
              throw new Error('TypeORM options are missing.');
            }
            const dataSource = await new DataSource({
              ...options,
              migrationsRun: false,
            }).initialize();
            if (options.migrationsRun) {
              await runMigrationsExclusively(dataSource);
            }
            return dataSource;
          },
        }),
        ClsModule.registerPlugins([
          new ClsPluginTransactional({
            adapter: new TransactionalAdapterTypeOrm({ dataSourceToken: getDataSourceToken() }),
          }),
        ]),
      ],
      providers: [{ provide: UNIT_OF_WORK, useClass: ClsUnitOfWork }],
      exports: [UNIT_OF_WORK],
    };
  }
}
