// The executable runbook for stuck or failing jobs. Reads BullMQ and the outbox of the compose
// stack (REDIS_URL, DATABASE_URL from .env).
//   pnpm queue:inspect                      every queue, the outbox backlog and the dead letters
//   pnpm queue:inspect <queue> [--limit N]  counts and the latest failed jobs of one queue
//   pnpm queue:inspect <queue> <jobId>      one job: state, attempts, error, stack, data, logs
//   pnpm queue:inspect <queue> <jobId> --retry | --remove
//   pnpm queue:inspect <queue> --retry-dead-letters   retry every dead letter that came from <queue>
import { type Job, type Queue } from 'bullmq';
import { type Client } from 'pg';

import { type DeadLetter } from '../../../../src/shared/infrastructure/queues/dead-letter.queue';
import { EVENT_JOB_OPTIONS } from '../../../../src/shared/infrastructure/queues/event-jobs';
import { ago, truncate, withConnections } from '../../../lib/runtime';
import { fail, parseArgs } from '../../../lib/scaffold';

const STATES = ['waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'] as const;
const { positional, flags, options } = parseArgs(process.argv.slice(2));
const [queueName, jobId] = positional;
const limit = Number(options.get('limit') ?? 5);

void withConnections(async ({ db, queues }) => {
  if (!queueName) {
    await overview(db, queues);
    return;
  }
  const queue =
    queues.get(queueName) ??
    fail(`unknown queue ${queueName}; known: ${[...queues.keys()].join(', ')}`);
  if (!jobId && flags.has('retry-dead-letters')) {
    await retryDeadLetters(queue, queues.get('dead-letter') ?? fail('no dead-letter queue'));
    return;
  }
  if (!jobId) {
    await queueReport(queue);
    return;
  }
  const job =
    (await queue.getJob(jobId)) ??
    fail(`no job ${jobId} in ${queueName} (completed jobs expire after 7 days)`);
  if (flags.has('retry')) {
    await job.retry();
    console.log(
      `retried ${queueName}/${jobId}; follow it with: pnpm queue:inspect ${queueName} ${jobId}`,
    );
    return;
  }
  if (flags.has('remove')) {
    await job.remove();
    console.log(`removed ${queueName}/${jobId}`);
    return;
  }
  await jobReport(queue, job);
}).catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Is the compose stack up (docker compose ps) and .env pointing at it?');
  process.exitCode = 1;
});

async function overview(db: Client, queues: Map<string, Queue>): Promise<void> {
  console.log('Queues');
  for (const [name, queue] of queues) {
    const counts = await queue.getJobCounts(...STATES);
    const line = STATES.map((state) => `${state} ${String(counts[state] ?? 0)}`).join('  ');
    const flag = (counts.failed ?? 0) > 0 ? '  <- failures' : '';
    console.log(`  ${name.padEnd(22)} ${line}${flag}`);
  }

  const [outbox] = (
    await db.query<{ pending: string; oldest: Date | null; erroring: string }>(
      `SELECT count(*) AS pending, min(created_at) AS oldest,
              count(*) FILTER (WHERE last_error IS NOT NULL) AS erroring
         FROM shared.outbox_messages WHERE published_at IS NULL`,
    )
  ).rows;
  console.log(
    `\nOutbox: ${outbox?.pending ?? '0'} unpublished, oldest ${ago(outbox?.oldest)}, ${outbox?.erroring ?? '0'} with errors`,
  );
  const errors = await db.query<{
    id: string;
    event_type: string;
    attempts: number;
    last_error: string;
  }>(
    `SELECT id, event_type, attempts, last_error FROM shared.outbox_messages
      WHERE published_at IS NULL AND last_error IS NOT NULL ORDER BY id LIMIT 5`,
  );
  for (const row of errors.rows) {
    console.log(
      `  ${row.id} ${row.event_type} attempts=${String(row.attempts)} ${truncate(row.last_error, 120)}`,
    );
  }

  const deadLetters = await queues
    .get('dead-letter')
    ?.getJobs(['waiting', 'completed', 'failed'], 0, 9);
  console.log(`\nDead letters (latest ${String(deadLetters?.length ?? 0)})`);
  for (const letter of deadLetters ?? []) {
    const data = letter.data as {
      queue?: string;
      jobId?: string;
      failedReason?: string;
      failedAt?: string;
    };
    console.log(
      `  ${letter.id ?? '?'}\n    ${data.failedAt ?? '-'} from ${data.queue ?? '?'}: ${truncate(data.failedReason ?? '', 120)}`,
    );
  }
  console.log(
    '\nNext: pnpm queue:inspect <queue> for its failures, or <queue> <jobId> for one job.',
  );
}

async function queueReport(queue: Queue): Promise<void> {
  const counts = await queue.getJobCounts(...STATES);
  console.log(
    `${queue.name}: ${STATES.map((state) => `${state} ${String(counts[state] ?? 0)}`).join('  ')}`,
  );
  const failed = await queue.getFailed(0, limit - 1);
  if (failed.length === 0) {
    console.log('no failed jobs');
    return;
  }
  console.log(`\nLatest failed jobs`);
  for (const job of failed) {
    console.log(
      `  ${job.id ?? '?'}  ${job.name}  attempts ${String(job.attemptsMade)}  ${ago(job.finishedOn)}  ${truncate(job.failedReason, 120)}`,
    );
  }
}

// After an outage every delivery that ran out of attempts meanwhile is a dead letter: retries
// them all, then removes their letters. A job still in its failed set is retried; one whose
// failed copy expired (30 days) is added again under its id, which only an event delivery can be
// (its data is the event); for the work queues the lever is the endpoint in the runbook.
async function retryDeadLetters(queue: Queue, deadLetters: Queue): Promise<void> {
  const letters = (await deadLetters.getJobs(['waiting', 'delayed', 'completed', 'failed'])).filter(
    (letter) => (letter.data as DeadLetter).queue === queue.name,
  );
  if (letters.length === 0) {
    console.log(`no dead letters from ${queue.name}`);
    return;
  }
  const outcome = { retried: 0, readded: 0, alreadyMoving: 0, skipped: 0 };
  for (const letter of letters) {
    const data = letter.data as DeadLetter;
    const job = data.jobId ? await queue.getJob(data.jobId) : undefined;
    if (job) {
      const state = await job.getState();
      if (state === 'failed') {
        await job.retry();
        outcome.retried += 1;
      } else {
        // Retried already (by hand, or a letter of the same job came first): only the letter goes.
        outcome.alreadyMoving += 1;
      }
    } else if (data.jobId && queue.name.startsWith('events.')) {
      await queue.add(data.jobName, data.data, { ...EVENT_JOB_OPTIONS, jobId: data.jobId });
      outcome.readded += 1;
    } else {
      console.log(
        `  kept ${letter.id ?? '?'}: ${queue.name}/${data.jobId ?? '?'} expired; use the endpoint in the runbook`,
      );
      outcome.skipped += 1;
      continue;
    }
    await letter.remove();
  }
  console.log(
    `${queue.name}: ${String(outcome.retried)} retried, ${String(outcome.readded)} added again, ` +
      `${String(outcome.alreadyMoving)} already retried, ${String(outcome.skipped)} kept; ` +
      `follow them with: pnpm queue:inspect ${queue.name}`,
  );
}

async function jobReport(queue: Queue, job: Job): Promise<void> {
  const state = await job.getState();
  const { logs } = await queue.getJobLogs(job.id ?? '');
  const attempts = job.opts.attempts ?? 1;
  console.log(`${queue.name}/${job.id ?? '?'}  ${job.name}`);
  console.log(`  state      ${state}`);
  console.log(`  attempts   ${String(job.attemptsMade)} of ${String(attempts)}`);
  console.log(`  created    ${new Date(job.timestamp).toISOString()} (${ago(job.timestamp)})`);
  console.log(`  processed  ${job.processedOn ? new Date(job.processedOn).toISOString() : '-'}`);
  console.log(`  finished   ${job.finishedOn ? new Date(job.finishedOn).toISOString() : '-'}`);
  if (job.failedReason) {
    console.log(`  error      ${job.failedReason}`);
  }
  for (const [index, trace] of (job.stacktrace ?? []).entries()) {
    console.log(
      `  stack #${String(index + 1)}\n    ${trace.split('\n').slice(0, 6).join('\n    ')}`,
    );
  }
  console.log(`  data       ${truncate(job.data, 600)}`);
  if (logs.length > 0) {
    console.log(`  logs\n    ${logs.join('\n    ')}`);
  }
  console.log(`\n${advice(state, job)}`);
}

// What to do next, by state and error. The decision stays with the operator.
function advice(state: string, job: Job): string {
  const reason = job.failedReason;
  // BullMQ stops retrying an UnrecoverableError, so a job failed before its last attempt is one.
  const permanent =
    (job.stacktrace ?? []).some((trace) => trace.startsWith('UnrecoverableError')) ||
    job.attemptsMade < (job.opts.attempts ?? 1) ||
    /validation|not found|invalid/i.test(reason);
  if (state === 'failed' && permanent) {
    return [
      'Permanent failure: retrying will fail the same way. It is already in the dead-letter queue.',
      ...KNOWN_CAUSES.filter(([pattern]) => pattern.test(reason)).map(
        ([, cause]) => `- cause: ${cause}`,
      ),
      '- fix the data or the code, then retry: --retry',
      '- or discard it if the effect is no longer wanted: --remove (and its dead letter)',
    ].join('\n');
  }
  if (state === 'failed') {
    return [
      'Looks transient (network, timeout, dependency down) or unknown.',
      '- check the dependency, then retry: --retry (consumers are idempotent, a retry is safe)',
      '- a copy is in the dead-letter queue once attempts are exhausted',
    ].join('\n');
  }
  if (state === 'waiting' || state === 'delayed') {
    return 'Not picked up yet: is the worker running (docker compose ps worker) and healthy?';
  }
  if (state === 'active') {
    return 'Running. If it stays active for minutes, the worker may have died holding it; BullMQ moves stalled jobs back after the lock expires.';
  }
  return 'Completed: nothing to do.';
}

// Failure messages produced by the platform itself, with what they usually mean.
const KNOWN_CAUSES: readonly [RegExp, string][] = [
  [
    /No subscriber is registered/,
    'the worker has no handler with this consumer name: it was renamed or removed, or the worker runs an older build',
  ],
  [/ConcurrentModification/i, 'two writers raced on the same aggregate; a retry normally succeeds'],
  [/ECONNREFUSED|ETIMEDOUT|ENOTFOUND/, 'a dependency was unreachable; check it before retrying'],
];
