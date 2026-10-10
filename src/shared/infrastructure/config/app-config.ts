import { z } from 'zod';

import { envSchema } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly http: {
    readonly port: number;
    readonly corsOrigins: readonly string[];
    readonly trustProxyHops: number;
  };
  readonly throttling: {
    readonly ttlMs: number;
    readonly limit: number;
    readonly authLimit: number;
  };
  readonly worker: { readonly healthPort: number };
  readonly log: { readonly level: string; readonly pretty: boolean };
  readonly docs: { readonly enabled: boolean };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
    readonly logQueries: boolean;
    readonly runMigrations: boolean;
  };
  readonly redis: { readonly url: string };
  readonly auth: {
    readonly jwtSecret: string;
    readonly accessTokenTtlSeconds: number;
    readonly refreshTokenTtlDays: number;
    readonly sessionMaxDays: number;
    readonly lockout: {
      readonly maxFailures: number;
      readonly baseLockSeconds: number;
      readonly maxLockSeconds: number;
    };
  };
  readonly outbox: {
    readonly enabled: boolean;
    readonly pollIntervalMs: number;
    readonly batchSize: number;
    readonly enqueueTimeoutMs: number;
  };
  readonly queueDashboard: { readonly username: string; readonly password: string | undefined };
}

export class InvalidConfigError extends Error {
  constructor(details: string) {
    super(`Invalid environment configuration:\n${details}`);
    this.name = 'InvalidConfigError';
  }
}

export type DatabaseConfig = AppConfig['database'];

const databaseEnvSchema = envSchema.pick({
  DATABASE_URL: true,
  DATABASE_POOL_MAX: true,
  DATABASE_LOG_QUERIES: true,
  DATABASE_RUN_MIGRATIONS: true,
});

// For tools that only touch the database (migration CLI, test setup), so they do not need the
// application's secrets.
export function parseDatabaseConfig(source: Record<string, string | undefined>): DatabaseConfig {
  const result = databaseEnvSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidConfigError(z.prettifyError(result.error));
  }
  return {
    url: result.data.DATABASE_URL,
    poolMax: result.data.DATABASE_POOL_MAX,
    logQueries: result.data.DATABASE_LOG_QUERIES,
    runMigrations: result.data.DATABASE_RUN_MIGRATIONS,
  };
}

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidConfigError(z.prettifyError(result.error));
  }
  const env = result.data;
  return {
    env: env.NODE_ENV,
    http: { port: env.PORT, corsOrigins: env.CORS_ORIGINS, trustProxyHops: env.TRUST_PROXY_HOPS },
    throttling: {
      ttlMs: env.THROTTLE_TTL_MS,
      limit: env.THROTTLE_LIMIT,
      authLimit: env.THROTTLE_AUTH_LIMIT,
    },
    worker: { healthPort: env.WORKER_HEALTH_PORT },
    // pino-pretty is a dev dependency and is not installed in the production image.
    log: { level: env.LOG_LEVEL, pretty: env.LOG_PRETTY && env.NODE_ENV !== 'production' },
    docs: { enabled: env.SWAGGER_ENABLED },
    database: {
      url: env.DATABASE_URL,
      poolMax: env.DATABASE_POOL_MAX,
      logQueries: env.DATABASE_LOG_QUERIES,
      runMigrations: env.DATABASE_RUN_MIGRATIONS,
    },
    redis: { url: env.REDIS_URL },
    auth: {
      jwtSecret: env.JWT_ACCESS_SECRET,
      accessTokenTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      sessionMaxDays: env.SESSION_MAX_DAYS,
      lockout: {
        maxFailures: env.LOGIN_MAX_FAILURES,
        baseLockSeconds: env.LOGIN_LOCK_BASE_SECONDS,
        maxLockSeconds: env.LOGIN_LOCK_MAX_SECONDS,
      },
    },
    outbox: {
      enabled: env.OUTBOX_PUBLISHER_ENABLED,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      enqueueTimeoutMs: env.OUTBOX_ENQUEUE_TIMEOUT_MS,
    },
    queueDashboard: { username: env.BULL_BOARD_USERNAME, password: env.BULL_BOARD_PASSWORD },
  };
}
