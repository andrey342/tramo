import { z } from 'zod';

const commaSeparated = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  WORKER_HEALTH_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: z.stringbool().default(false),
  CORS_ORIGINS: commaSeparated,
  THROTTLE_TTL_MS: z.coerce.number().int().min(1_000).default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  SWAGGER_ENABLED: z.stringbool().default(true),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_LOG_QUERIES: z.stringbool().default(false),
  DATABASE_RUN_MIGRATIONS: z.stringbool().default(false),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  OUTBOX_PUBLISHER_ENABLED: z.stringbool().default(true),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  BULL_BOARD_USERNAME: z.string().min(1).default('ops'),
  // Bull Board is only served when a password is configured.
  BULL_BOARD_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;
