import { join } from 'node:path';

import { type DataSourceOptions } from 'typeorm';

import { type AppConfig } from '../config';

// Globs resolve against this file, so they work for compiled output (dist/src/**) and for sources
// loaded through ts-jest (src/**). TypeORM's glob needs forward slashes, also on Windows.
const SRC_ROOT = join(__dirname, '..', '..', '..');
const glob = (pattern: string): string => join(SRC_ROOT, pattern).replace(/\\/g, '/');

export const MIGRATIONS_GLOB = glob('**/migrations/*.{js,ts}');
export const ENTITIES_GLOB = glob('**/*.orm-entity.{js,ts}');

export function typeOrmOptions(config: AppConfig, applicationName: string): DataSourceOptions {
  return {
    type: 'postgres',
    url: config.database.url,
    applicationName,
    poolSize: config.database.poolMax,
    // The schema is owned by migrations; nothing is ever synchronized from entity metadata.
    synchronize: false,
    migrations: [MIGRATIONS_GLOB],
    migrationsRun: config.database.runMigrations,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    logging: config.database.logQueries ? ['query', 'error'] : ['error'],
  };
}
