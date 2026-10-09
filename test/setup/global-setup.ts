import { startInfrastructure, type TestInfrastructure } from './containers';
import { migrateTestDatabase } from './migrate';

declare global {
  var __TRAMO_INFRA__: TestInfrastructure | undefined;
}

// Containers start once per run; workers inherit the connection strings through the environment.
export default async function globalSetup(): Promise<void> {
  const infra = await startInfrastructure();
  globalThis.__TRAMO_INFRA__ = infra;
  process.env.NODE_ENV = 'test';
  process.env.LOG_LEVEL = 'silent';
  process.env.LOG_PRETTY = 'false';
  process.env.DATABASE_URL = infra.postgres.getConnectionUri();
  process.env.REDIS_URL = infra.redis.getConnectionUrl();
  process.env.JWT_ACCESS_SECRET = 'test-secret-that-is-at-least-32-characters';
  await migrateTestDatabase(process.env);
}
