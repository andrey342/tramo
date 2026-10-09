import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { loadDotEnv, parseConfig } from '../config';

import { ENTITIES_GLOB, typeOrmOptions } from './typeorm-options';

// Entry point for the TypeORM CLI (`pnpm migration:*`), which runs against the compiled output.
// The application itself builds its DataSource through TypeOrmModule.
loadDotEnv();

export const dataSource = new DataSource({
  ...typeOrmOptions(parseConfig(process.env), 'tramo-migrations'),
  entities: [ENTITIES_GLOB],
  migrationsRun: false,
});
