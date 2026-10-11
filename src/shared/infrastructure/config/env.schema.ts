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
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),
  // Defaults to on, except in production.
  SWAGGER_ENABLED: z.stringbool().optional(),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  DATABASE_LOG_QUERIES: z.stringbool().default(false),
  DATABASE_RUN_MIGRATIONS: z.stringbool().default(false),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),
  // HS256 signing key for access tokens. 32+ characters; rotate by redeploying (tokens live 15 min).
  JWT_ACCESS_SECRET: z.string().min(32),
  // AES-256 key for encrypted columns (payout IBANs, webhook secrets): 32 bytes in base64.
  FIELD_ENCRYPTION_KEY: z.string().refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: 'must be 32 bytes encoded in base64 (openssl rand -base64 32)',
  }),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3_600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(1).default(5),
  LOGIN_LOCK_BASE_SECONDS: z.coerce.number().int().min(1).default(60),
  LOGIN_LOCK_MAX_SECONDS: z.coerce.number().int().min(1).default(3_600),
  // VAT checks: `live` asks VIES, `test` its test service (100 valid, 200 invalid, 300 down),
  // `fake` answers locally with the same table and needs no network.
  VIES_MODE: z.enum(['live', 'test', 'fake']).default('live'),
  VIES_BASE_URL: z.url().default('https://ec.europa.eu/taxation_customs/vies/rest-api'),
  VIES_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5_000),
  // How long the simulated KYC, employment and bureau providers take to answer, "min-max" in ms.
  SIMULATED_PROVIDER_LATENCY_MS: z
    .string()
    .regex(/^\d{1,5}-\d{1,5}$/, 'Expected "<min>-<max>" milliseconds, e.g. 300-800')
    .transform((value) => {
      const [minMs = 0, maxMs = 0] = value.split('-').map(Number);
      return { minMs, maxMs };
    })
    .refine((range) => range.minMs <= range.maxMs, 'The minimum must not exceed the maximum')
    .default({ minMs: 300, maxMs: 800 }),
  OUTBOX_PUBLISHER_ENABLED: z.stringbool().default(true),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).max(60_000).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  // A batch whose jobs Redis has not accepted by then is rolled back and retried with backoff.
  // Capped well below Postgres' 60 s idle-in-transaction limit, which would otherwise end the
  // publisher's session before it can roll back cleanly.
  OUTBOX_ENQUEUE_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(10_000),
  BULL_BOARD_USERNAME: z.string().min(1).default('ops'),
  // Bull Board is only served when a password is configured.
  BULL_BOARD_PASSWORD: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(8).optional(),
  ),
  // Number of reverse proxies in front of the api; the client IP for rate limiting is read from
  // X-Forwarded-For only when this is set.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

export type Env = z.infer<typeof envSchema>;
