import { type DataSource, type Migration, MigrationExecutor } from 'typeorm';

// Arbitrary, fixed key for pg_advisory_lock; only Tramo's migration runner takes it.
const MIGRATION_LOCK_KEY = 7_302_026_101;

// Several api replicas may start at the same time. One of them applies the pending migrations
// while the others wait on a session-level advisory lock and then find nothing left to do.
// Lock and migrations share one connection, so this works with a pool of one.
export async function runMigrationsExclusively(dataSource: DataSource): Promise<Migration[]> {
  const queryRunner = dataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    await queryRunner.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    const executor = new MigrationExecutor(dataSource, queryRunner);
    executor.transaction = 'each';
    return await executor.executePendingMigrations();
  } finally {
    await queryRunner
      .query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY])
      .catch(() => undefined);
    await queryRunner.release();
  }
}
