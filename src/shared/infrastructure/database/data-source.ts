import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { loadDotEnv, parseDatabaseConfig } from '../config';

import { ConsoleTypeOrmLogger } from './typeorm-logger';
import { ENTITIES_GLOB, typeOrmOptions } from './typeorm-options';

// Entry point for the TypeORM CLI (`pnpm migration:*`), which runs against the compiled output.
// The application itself builds its DataSource through TypeOrmModule.
loadDotEnv();

const database = parseDatabaseConfig(process.env);

export const dataSource = new DataSource({
  ...typeOrmOptions(database, 'tramo-migrations'),
  entities: [ENTITIES_GLOB],
  migrationsRun: false,
  // The CLI's commands set their own log levels, which a logger instance does not take: schema
  // messages are what `migration:show` lists (and `pnpm migration:verify` parses); statements are
  // echoed only with DATABASE_LOG_QUERIES, as in the application.
  logger: new ConsoleTypeOrmLogger(
    database.logQueries ? ['query', 'error', 'schema'] : ['error', 'schema'],
  ),
});
