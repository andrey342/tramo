// Follows one aggregate (an application, a contract, a user...) through every place its effects
// land, as one timeline, and points at the first broken link.
//   pnpm trace <aggregateId>
// Sources: outbox events that name it, the queue jobs those events fanned out to (job id
// `<eventId>.<consumer>`), consumers' processed marks, dead letters, audit log entries, emails in
// Mailpit and deliveries received by the webhook sink.
import { Job, type Queue } from 'bullmq';
import { type Redis } from 'ioredis';
import { type Client } from 'pg';

import { env, QUEUE_PREFIX, truncate, withConnections } from '../../../lib/runtime';
import { fail, parseArgs } from '../../../lib/scaffold';

interface Entry {
  at: Date;
  source: string;
  text: string;
  broken?: string;
}

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: Date;
  published_at: Date | null;
  attempts: number;
  last_error: string | null;
}

const { positional } = parseArgs(process.argv.slice(2));
const id = positional[0] ?? fail('usage: pnpm trace <aggregateId>');

void withConnections(async ({ db, redis, queues }) => {
  const entries: Entry[] = [];
  const events = await outboxEvents(db, entries);
  await queueJobs(redis, queues, events, entries);
  await workJobs(redis, queues, entries);
  await processedMarks(db, events, entries);
  await auditEntries(db, entries);
  await emails(entries);
  await webhooks(entries);
  print(entries);
}).catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function outboxEvents(db: Client, entries: Entry[]): Promise<OutboxRow[]> {
  // Events of the aggregate itself, and events of other aggregates whose payload names it.
  const { rows } = await db.query<OutboxRow>(
    `SELECT id, event_type, aggregate_type, aggregate_id, occurred_at, published_at, attempts, last_error
       FROM shared.outbox_messages
      WHERE aggregate_id = $1 OR payload::text LIKE '%' || $1 || '%'
      ORDER BY id`,
    [id],
  );
  for (const row of rows) {
    const subject = row.aggregate_id === id ? '' : ` (${row.aggregate_type} ${row.aggregate_id})`;
    entries.push({
      at: row.occurred_at,
      source: 'event',
      text: `${row.event_type}${subject}  ${row.id}`,
    });
    if (row.published_at) {
      entries.push({ at: row.published_at, source: 'outbox', text: `published ${row.event_type}` });
    } else {
      entries.push({
        at: row.occurred_at,
        source: 'outbox',
        text: `${row.event_type} not published (attempts ${String(row.attempts)})${row.last_error ? `: ${truncate(row.last_error, 120)}` : ''}`,
        broken:
          'the outbox publisher has not sent this event: is the worker up and Redis reachable?',
      });
    }
  }
  return rows;
}

async function queueJobs(
  redis: Redis,
  queues: Map<string, Queue>,
  events: OutboxRow[],
  entries: Entry[],
): Promise<void> {
  for (const event of events) {
    // Job hashes are stored at `<prefix>:<queue>:<jobId>`; jobIds start with the event id, and
    // dead letters with `<queue>.<jobId>`.
    const keys = [
      ...(await scan(redis, `${QUEUE_PREFIX}:events.*:${event.id}.*`)),
      ...(await scan(redis, `${QUEUE_PREFIX}:dead-letter:*.${event.id}.*`)),
    ];
    for (const key of keys) {
      const match = /^[^:]+:([^:]+):([^:]+)$/.exec(key);
      const queue = match ? queues.get(match[1] ?? '') : undefined;
      if (!match || !queue) continue;
      const job = await Job.fromId(queue, match[2] ?? '');
      if (!job) continue;
      const state = await job.getState();
      const attempts = job.attemptsMade > 0 ? ` after ${String(job.attemptsMade)} attempt(s)` : '';
      const reason = job.failedReason ? ` - ${truncate(job.failedReason, 120)}` : '';
      const text =
        queue.name === 'dead-letter'
          ? `dead-letter: ${job.name} parked for redelivery or removal`
          : `${queue.name} ${job.name}: ${state}${attempts}${reason}`;
      entries.push({
        at: new Date(job.finishedOn ?? job.processedOn ?? job.timestamp),
        source: 'job',
        text,
        broken:
          queue.name === 'dead-letter'
            ? `${event.event_type} reached the dead-letter queue: pnpm queue:inspect dead-letter ${job.id ?? ''}`
            : state === 'failed'
              ? `${job.name} failed on ${event.event_type}: pnpm queue:inspect ${queue.name} ${job.id ?? ''}`
              : state === 'delayed' && job.attemptsMade > 0
                ? `${job.name} failed ${String(job.attemptsMade)} time(s) on ${event.event_type} and waits to retry: pnpm queue:inspect ${queue.name} ${job.id ?? ''}`
                : state === 'waiting' || state === 'delayed'
                  ? `${job.name} has not run yet: is the worker up?`
                  : undefined,
      });
    }
  }
}

// Jobs of a module's own work queues are keyed by the aggregate itself: a center's VAT check
// (`catalog.vat-checks:<centerId>`), an application's verifications
// (`origination.verifications:<applicationId>.<provider>`), and their dead letters.
async function workJobs(redis: Redis, queues: Map<string, Queue>, entries: Entry[]): Promise<void> {
  const keys = [
    ...(await scan(redis, `${QUEUE_PREFIX}:*:${id}`)),
    ...(await scan(redis, `${QUEUE_PREFIX}:*:${id}.*`)),
    ...(await scan(redis, `${QUEUE_PREFIX}:dead-letter:*.${id}*`)),
  ];
  for (const key of new Set(keys)) {
    const match = /^[^:]+:([^:]+):([^:]+)$/.exec(key);
    const queue = match ? queues.get(match[1] ?? '') : undefined;
    if (!match || !queue || queue.name.startsWith('events.')) continue;
    const job = await Job.fromId(queue, match[2] ?? '');
    if (!job) continue;
    const state = await job.getState();
    const attempts = job.attemptsMade > 0 ? ` after ${String(job.attemptsMade)} attempt(s)` : '';
    const reason = job.failedReason ? ` - ${truncate(job.failedReason, 120)}` : '';
    entries.push({
      at: new Date(job.finishedOn ?? job.processedOn ?? job.timestamp),
      source: 'job',
      text:
        queue.name === 'dead-letter'
          ? `dead-letter: ${job.name} parked for redelivery or removal`
          : `${queue.name} ${job.name}: ${state}${attempts}${reason}`,
      broken:
        queue.name === 'dead-letter'
          ? `${job.name} reached the dead-letter queue: pnpm queue:inspect dead-letter ${job.id ?? ''}`
          : state === 'failed'
            ? `${job.name} failed: pnpm queue:inspect ${queue.name} ${job.id ?? ''}`
            : state === 'delayed' && job.attemptsMade > 0
              ? `${job.name} failed ${String(job.attemptsMade)} time(s) and waits to retry (a provider outage?): pnpm queue:inspect ${queue.name} ${job.id ?? ''}`
              : state === 'waiting' || state === 'delayed'
                ? `${job.name} has not run yet: is the worker up?`
                : undefined,
    });
  }
}

async function processedMarks(db: Client, events: OutboxRow[], entries: Entry[]): Promise<void> {
  if (events.length === 0) return;
  const { rows } = await db.query<{ event_id: string; consumer: string; processed_at: Date }>(
    `SELECT event_id, consumer, processed_at FROM shared.processed_events WHERE event_id = ANY($1)`,
    [events.map((event) => event.id)],
  );
  for (const row of rows) {
    entries.push({
      at: row.processed_at,
      source: 'consumer',
      text: `${row.consumer} applied ${row.event_id}`,
    });
  }
}

async function auditEntries(db: Client, entries: Entry[]): Promise<void> {
  const { rows } = await db.query<{
    occurred_at: Date;
    action: string;
    outcome: string;
    actor_type: string;
    actor_id: string | null;
    error_code: string | null;
    request_id: string | null;
  }>(
    `SELECT occurred_at, action, outcome, actor_type, actor_id, error_code, request_id
       FROM shared.audit_log
      WHERE resource_id = $1 OR changes::text LIKE '%' || $1 || '%'
      ORDER BY occurred_at`,
    [id],
  );
  for (const row of rows) {
    entries.push({
      at: row.occurred_at,
      source: 'audit',
      text: `${row.action} ${row.outcome} by ${row.actor_type} ${row.actor_id ?? ''}${row.error_code ? ` (${row.error_code})` : ''} request ${row.request_id ?? '-'}`,
    });
  }
}

async function emails(entries: Entry[]): Promise<void> {
  const url = env('MAILPIT_URL', `http://localhost:${env('MAILPIT_UI_PORT', '8025')}`);
  const found = await getJson<{
    messages?: { Subject: string; To: { Address: string }[]; Created: string }[];
  }>(`${url}/api/v1/search?query=${encodeURIComponent(id)}`);
  if (found === undefined) {
    entries.push({
      at: new Date(0),
      source: 'mail',
      text: `Mailpit not reachable at ${url}; emails not checked`,
    });
    return;
  }
  for (const message of found.messages ?? []) {
    entries.push({
      at: new Date(message.Created),
      source: 'mail',
      text: `"${message.Subject}" to ${message.To.map((to) => to.Address).join(', ')}`,
    });
  }
}

async function webhooks(entries: Entry[]): Promise<void> {
  const url = env('WEBHOOK_SINK_URL', `http://localhost:${env('WEBHOOK_SINK_PORT', '9099')}`);
  const found = await getJson<{
    data: { receivedAt: string; event: string | null; path: string; body: unknown }[];
  }>(`${url}/deliveries`);
  if (found === undefined) {
    entries.push({
      at: new Date(0),
      source: 'webhook',
      text: `webhook sink not reachable at ${url}; deliveries not checked`,
    });
    return;
  }
  for (const delivery of found.data.filter((item) => JSON.stringify(item.body).includes(id))) {
    entries.push({
      at: new Date(delivery.receivedAt),
      source: 'webhook',
      text: `${delivery.event ?? 'delivery'} received at ${delivery.path}`,
    });
  }
}

function print(entries: Entry[]): void {
  // Entries without a time are notes about sources that could not be checked.
  if (entries.every((entry) => entry.at.getTime() === 0)) {
    for (const note of entries) console.log(note.text);
    console.log(
      `Nothing references ${id} in the outbox, queues, audit log, Mailpit or the webhook sink.`,
    );
    console.log(
      'Check the id, or whether the request that should have created it failed (pnpm api:call ...).',
    );
    return;
  }
  const sorted = [...entries].sort((a, b) => a.at.getTime() - b.at.getTime());
  console.log(`Timeline of ${id}\n`);
  for (const entry of sorted) {
    const at = entry.at.getTime() === 0 ? '-'.padEnd(24) : entry.at.toISOString();
    console.log(`${at}  ${entry.source.padEnd(8)} ${entry.broken ? '!! ' : ''}${entry.text}`);
  }
  const broken = sorted.find((entry) => entry.broken);
  console.log(
    broken
      ? `\nFirst broken link: ${broken.broken ?? ''}`
      : '\nNo broken link: every event was published and every job that ran succeeded.',
  );
}

async function scan(redis: Redis, pattern: string): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 1000);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

async function getJson<T>(url: string): Promise<T | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return response.ok ? ((await response.json()) as T) : undefined;
  } catch {
    return undefined;
  }
}
