import { type DataSourceOptions } from 'typeorm';

import { type AppConfig } from '../config';

export function typeOrmOptions(config: AppConfig, applicationName: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.database.url,
    applicationName,
    poolSize: config.database.poolMax,
    // The schema is owned by migrations; nothing is ever synchronized from entity metadata.
    synchronize: false,
    migrationsRun: false,
    logging: config.database.logQueries ? ['query', 'error'] : ['error'],
  };
}
