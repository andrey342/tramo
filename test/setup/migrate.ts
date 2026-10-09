import { DataSource } from 'typeorm';

import { parseConfig } from '../../src/shared/infrastructure/config/app-config';
import { typeOrmOptions } from '../../src/shared/infrastructure/database/typeorm-options';

// Test databases are built by the real migrations, never by synchronize, so schema drift between
// entities and migrations fails the suite.
export async function migrateTestDatabase(env: Record<string, string | undefined>): Promise<void> {
  const dataSource = new DataSource(typeOrmOptions(parseConfig(env), 'tramo-test-migrations'));
  await dataSource.initialize();
  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
