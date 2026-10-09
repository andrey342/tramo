import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';

export const POSTGRES_IMAGE = 'postgres:16-alpine';
export const REDIS_IMAGE = 'redis:7-alpine';

export interface TestInfrastructure {
  readonly postgres: StartedPostgreSqlContainer;
  readonly redis: StartedRedisContainer;
}

export async function startInfrastructure(): Promise<TestInfrastructure> {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer(POSTGRES_IMAGE)
      .withDatabase('tramo')
      .withUsername('tramo')
      .withPassword('tramo')
      .start(),
    new RedisContainer(REDIS_IMAGE).start(),
  ]);
  return { postgres, redis };
}
