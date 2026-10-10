// Connections for the diagnostic scripts (debug-job, trace, try-endpoint). They talk to the
// compose stack with the same variables the app reads from .env.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { Client } from 'pg';

import { ALL_QUEUES } from '../../src/shared/infrastructure/queues/queue-names';

import { ROOT } from './scaffold';

// Same prefix as QueuesModule.
export const QUEUE_PREFIX = 'tramo';

export function loadEnv(): void {
  const file = join(ROOT, '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

export function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export async function withConnections<T>(
  work: (connections: { db: Client; redis: Redis; queues: Map<string, Queue> }) => Promise<T>,
): Promise<T> {
  loadEnv();
  const db = new Client({
    connectionString: env('DATABASE_URL', 'postgres://tramo:tramo@localhost:5432/tramo'),
  });
  const redisUrl = env('REDIS_URL', 'redis://localhost:6379');
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true });
  const queues = new Map(
    ALL_QUEUES.map((name) => [
      name,
      new Queue(name, {
        prefix: QUEUE_PREFIX,
        connection: { url: redisUrl, maxRetriesPerRequest: 1 },
      }),
    ]),
  );
  try {
    await Promise.all([db.connect(), redis.connect()]);
    return await work({ db, redis, queues });
  } finally {
    await Promise.allSettled([
      db.end(),
      redis.quit(),
      ...[...queues.values()].map((queue) => queue.close()),
    ]);
  }
}

export function ago(date: Date | number | null | undefined): string {
  if (date === null || date === undefined) return '-';
  const ms = Date.now() - (typeof date === 'number' ? date : date.getTime());
  if (ms < 1_000) return 'just now';
  if (ms < 60_000) return `${String(Math.round(ms / 1_000))}s ago`;
  if (ms < 3_600_000) return `${String(Math.round(ms / 60_000))}m ago`;
  return `${String(Math.round(ms / 3_600_000))}h ago`;
}

export function truncate(value: unknown, max = 300): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
