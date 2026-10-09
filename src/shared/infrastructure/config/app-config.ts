import { z } from 'zod';

import { envSchema } from './env.schema';

export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppConfig {
  readonly env: 'development' | 'test' | 'production';
  readonly http: { readonly port: number; readonly corsOrigins: readonly string[] };
  readonly throttling: { readonly ttlMs: number; readonly limit: number };
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
  readonly outbox: {
    readonly enabled: boolean;
    readonly pollIntervalMs: number;
    readonly batchSize: number;
  };
  readonly queueDashboard: { readonly username: string; readonly password: string | undefined };
}

export class InvalidConfigError extends Error {
  constructor(details: string) {
    super(`Invalid environment configuration:\n${details}`);
    this.name = 'InvalidConfigError';
  }
}

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidConfigError(z.prettifyError(result.error));
  }
  const env = result.data;
  return {
    env: env.NODE_ENV,
    http: { port: env.PORT, corsOrigins: env.CORS_ORIGINS },
    throttling: { ttlMs: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
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
    outbox: {
      enabled: env.OUTBOX_PUBLISHER_ENABLED,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
    },
    queueDashboard: { username: env.BULL_BOARD_USERNAME, password: env.BULL_BOARD_PASSWORD },
  };
}
