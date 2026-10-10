import { DataSource } from 'typeorm';

import { parseDatabaseConfig } from '../../src/shared/infrastructure/config/app-config';
import { runMigrationsExclusively } from '../../src/shared/infrastructure/database/run-migrations';
import { typeOrmOptions } from '../../src/shared/infrastructure/database/typeorm-options';

// Test databases are built by the real migrations, never by synchronize, so schema drift between
// entities and migrations fails the suite.
export async function migrateTestDatabase(env: Record<string, string | undefined>): Promise<void> {
  const dataSource = new DataSource(
    typeOrmOptions(parseDatabaseConfig(env), 'tramo-test-migrations'),
  );
  await dataSource.initialize();
  try {
    await runMigrationsExclusively(dataSource);
  } finally {
    await dataSource.destroy();
  }
}
