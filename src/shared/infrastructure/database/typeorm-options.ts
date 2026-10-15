import { join } from 'node:path';

import { type DataSourceOptions } from 'typeorm';

import { type DatabaseConfig } from '../config';

import { ConsoleTypeOrmLogger } from './typeorm-logger';

// Globs resolve against this file, so they work for compiled output (dist/src/**) and for sources
// loaded through ts-jest (src/**). TypeORM's glob needs forward slashes, also on Windows.
const SRC_ROOT = join(__dirname, '..', '..', '..');
const glob = (pattern: string): string => join(SRC_ROOT, pattern).replace(/\\/g, '/');

const IDLE_IN_TRANSACTION_TIMEOUT_MS = 60_000;
// A Postgres that stops answering (paused, a network partition) would hold requests forever: a new
// connection gives up after this long in every process, and an api query after QUERY_TIMEOUT_MS,
// so the client gets 503 database_unavailable. Workers and the migrations CLI keep no query limit:
// a job or a data migration may run longer.
const CONNECTION_TIMEOUT_MS = 5_000;
const QUERY_TIMEOUT_MS = 30_000;
const API_APPLICATION = 'tramo-api';

export const MIGRATIONS_GLOB = glob('**/migrations/*.{js,ts}');
export const ENTITIES_GLOB = glob('**/*.orm-entity.{js,ts}');

export function typeOrmOptions(
  database: DatabaseConfig,
  applicationName: string,
): DataSourceOptions {
  return {
    type: 'postgres',
    url: database.url,
    applicationName,
    poolSize: database.poolMax,
    // The schema is owned by migrations; nothing is ever synchronized from entity metadata.
    synchronize: false,
    migrations: [MIGRATIONS_GLOB],
    // Read by DatabaseModule, which applies migrations itself under an advisory lock; TypeORM's
    // own run at initialisation has no lock and races between replicas.
    migrationsRun: database.runMigrations,
    migrationsTableName: 'migrations',
    migrationsTransactionMode: 'each',
    // Never TypeORM's own console logger, which prints the bound parameters. The api and the
    // worker replace this one with TypeOrmLogger, which writes through pino (DatabaseModule).
    logger: new ConsoleTypeOrmLogger(database.logQueries ? ['query', 'error'] : ['error']),
    // A transaction left open by a stuck caller would hold row locks indefinitely; Postgres ends
    // the session instead.
    extra: {
      idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
      connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      ...(applicationName === API_APPLICATION && { query_timeout: QUERY_TIMEOUT_MS }),
    },
  };
}
