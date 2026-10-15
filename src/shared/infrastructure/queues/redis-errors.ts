import { type Logger } from '@nestjs/common';

// How often a queue or a worker that keeps failing to reach Redis says so.
export const REDIS_ERROR_LOG_INTERVAL_MS = 60_000;

// Failures of the connection itself: Redis restarting or away, a reset by a proxy (Docker
// Desktop's port forwarding), commands given up while disconnected.
const CONNECTION_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EAI_AGAIN',
]);
const CONNECTION_ERROR_MESSAGES =
  /Connection is closed|max retries per request|Stream isn't writeable/;

export function isConnectionError(error: Error): boolean {
  const { code } = error as { code?: unknown };
  return (
    (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) ||
    CONNECTION_ERROR_MESSAGES.test(error.message)
  );
}

// Reports the 'error' events of a queue or a worker; without a listener BullMQ prints each one as a
// raw stack trace outside the logger. A connection error repeats with every reconnect attempt
// while Redis is away, so it is said at most once per interval: ioredis reconnects by itself and
// readiness reports the outage. Any other error (a lost job lock, a failed script) is said each
// time.
export class RedisErrorReporter {
  private connectionErrorLoggedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly logger: Logger,
    private readonly subject: 'Queue' | 'Worker',
    private readonly context: Readonly<Record<string, unknown>> = {},
  ) {}

  report(error: Error): void {
    const fields = { ...this.context, err: error.message };
    if (!isConnectionError(error)) {
      this.logger.error(fields, `${this.subject} error`);
      return;
    }
    const now = Date.now();
    if (now - this.connectionErrorLoggedAt >= REDIS_ERROR_LOG_INTERVAL_MS) {
      this.connectionErrorLoggedAt = now;
      this.logger.warn(fields, `${this.subject} cannot reach Redis`);
    }
  }
}
