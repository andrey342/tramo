import { z } from 'zod';

import { type Env, envSchema } from './env.schema';

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
  readonly crypto: { readonly fieldEncryptionKey: string };
  readonly vies: {
    readonly mode: 'live' | 'test' | 'fake';
    readonly baseUrl: string;
    readonly timeoutMs: number;
  };
  readonly verification: {
    readonly providers: 'simulated';
    readonly simulatedLatency: { readonly minMs: number; readonly maxMs: number };
  };
  readonly lending: {
    readonly providers: 'simulated';
    // Current first, then the previous one during a rotation.
    readonly esignWebhookSecrets: readonly string[];
  };
  readonly billing: {
    readonly provider: 'simulated';
    // Current first, then the previous one during a rotation.
    readonly pspWebhookSecrets: readonly string[];
    readonly pspCallbackUrl: string;
    readonly simulatedPspDelayMs: number;
    // Whether ops may run billing as of a day still to come (the demo walks the months).
    readonly futureRunsEnabled: boolean;
  };
  readonly notifications: {
    readonly smtp: {
      readonly host: string;
      readonly port: number;
      readonly secure: boolean;
      readonly user: string | undefined;
      readonly password: string | undefined;
    };
    readonly emailFrom: string;
    readonly webhooks: {
      readonly timeoutMs: number;
      readonly retryDelayMs: number;
      readonly privateTargetsEnabled: boolean;
    };
  };
  readonly outbox: {
    readonly enabled: boolean;
    readonly pollIntervalMs: number;
    readonly batchSize: number;
    readonly enqueueTimeoutMs: number;
  };
  readonly queueDashboard: { readonly username: string; readonly password: string | undefined };
  readonly metrics: { readonly token: string | undefined };
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

// Values published in .env.example and docker-compose.yml. Anyone can read them, so a production
// process refuses to start with them: a known JWT secret lets anyone forge an admin token.
const PUBLISHED_SECRETS = {
  JWT_ACCESS_SECRET: (value: string) => /change-me/i.test(value),
  BULL_BOARD_PASSWORD: (value: string | undefined) => value === 'tramo-queues',
  METRICS_TOKEN: (value: string | undefined) => value !== undefined && /change-me/i.test(value),
  FIELD_ENCRYPTION_KEY: (value: string) => value === 'K0ZDSqr9YOcVMSLG1k4+T3Ie9/nmSDRZDMoifZ6VyIU=',
  ESIGN_WEBHOOK_SECRET: (value: string) => /change-me/i.test(value),
  PSP_WEBHOOK_SECRET: (value: string) => /change-me/i.test(value),
} as const;

function assertProductionSettings(env: Env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }
  const published = [
    PUBLISHED_SECRETS.JWT_ACCESS_SECRET(env.JWT_ACCESS_SECRET) ? 'JWT_ACCESS_SECRET' : undefined,
    PUBLISHED_SECRETS.BULL_BOARD_PASSWORD(env.BULL_BOARD_PASSWORD)
      ? 'BULL_BOARD_PASSWORD'
      : undefined,
    PUBLISHED_SECRETS.METRICS_TOKEN(env.METRICS_TOKEN) ? 'METRICS_TOKEN' : undefined,
    PUBLISHED_SECRETS.FIELD_ENCRYPTION_KEY(env.FIELD_ENCRYPTION_KEY)
      ? 'FIELD_ENCRYPTION_KEY'
      : undefined,
    PUBLISHED_SECRETS.ESIGN_WEBHOOK_SECRET(env.ESIGN_WEBHOOK_SECRET)
      ? 'ESIGN_WEBHOOK_SECRET'
      : undefined,
    PUBLISHED_SECRETS.PSP_WEBHOOK_SECRET(env.PSP_WEBHOOK_SECRET) ? 'PSP_WEBHOOK_SECRET' : undefined,
  ].filter((name) => name !== undefined);
  const problems = published.map(
    (name) => `✖ ${name} still has the development value; set a secret of your own.`,
  );
  // A center could point its webhook inside the network (ADR 018).
  if (env.WEBHOOK_PRIVATE_TARGETS_ENABLED === true) {
    problems.push(
      '✖ WEBHOOK_PRIVATE_TARGETS_ENABLED is true; production posts only to public addresses.',
    );
  }
  // The compose defaults: no real mail server, and a sender domain nobody owns.
  if (env.SMTP_HOST === 'localhost' || env.SMTP_HOST === 'mailpit') {
    problems.push(`✖ SMTP_HOST is ${env.SMTP_HOST}; production needs a real mail server.`);
  }
  if (/@tramo\.test>?$/i.test(env.EMAIL_FROM)) {
    problems.push('✖ EMAIL_FROM is the development sender; set an address of your own domain.');
  }
  // The test service and the fake activate centers whose VAT number nobody checked.
  if (env.VIES_MODE !== 'live') {
    problems.push(`✖ VIES_MODE is ${env.VIES_MODE}; production checks VAT numbers on VIES (live).`);
  }
  if (problems.length > 0) {
    throw new InvalidConfigError(problems.join('\n'));
  }
}

export function parseConfig(source: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new InvalidConfigError(z.prettifyError(result.error));
  }
  const env = result.data;
  assertProductionSettings(env);
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
    docs: { enabled: env.SWAGGER_ENABLED ?? env.NODE_ENV !== 'production' },
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
    crypto: { fieldEncryptionKey: env.FIELD_ENCRYPTION_KEY },
    vies: { mode: env.VIES_MODE, baseUrl: env.VIES_BASE_URL, timeoutMs: env.VIES_TIMEOUT_MS },
    verification: {
      providers: env.VERIFICATION_PROVIDERS,
      simulatedLatency: env.SIMULATED_PROVIDER_LATENCY_MS,
    },
    lending: {
      providers: env.LENDING_PROVIDERS,
      esignWebhookSecrets: [env.ESIGN_WEBHOOK_SECRET, env.ESIGN_WEBHOOK_PREVIOUS_SECRET].filter(
        (secret) => secret !== undefined,
      ),
    },
    billing: {
      provider: env.PAYMENT_PROVIDER,
      pspWebhookSecrets: [env.PSP_WEBHOOK_SECRET, env.PSP_WEBHOOK_PREVIOUS_SECRET].filter(
        (secret) => secret !== undefined,
      ),
      pspCallbackUrl: env.PSP_CALLBACK_URL,
      simulatedPspDelayMs: env.SIMULATED_PSP_DELAY_MS,
      futureRunsEnabled: env.BILLING_FUTURE_RUNS_ENABLED ?? env.NODE_ENV !== 'production',
    },
    notifications: {
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      },
      emailFrom: env.EMAIL_FROM,
      webhooks: {
        timeoutMs: env.WEBHOOK_TIMEOUT_MS,
        retryDelayMs: env.WEBHOOK_RETRY_DELAY_MS,
        privateTargetsEnabled: env.WEBHOOK_PRIVATE_TARGETS_ENABLED ?? env.NODE_ENV !== 'production',
      },
    },
    outbox: {
      enabled: env.OUTBOX_PUBLISHER_ENABLED,
      pollIntervalMs: env.OUTBOX_POLL_INTERVAL_MS,
      batchSize: env.OUTBOX_BATCH_SIZE,
      enqueueTimeoutMs: env.OUTBOX_ENQUEUE_TIMEOUT_MS,
    },
    queueDashboard: { username: env.BULL_BOARD_USERNAME, password: env.BULL_BOARD_PASSWORD },
    metrics: { token: env.METRICS_TOKEN },
  };
}
