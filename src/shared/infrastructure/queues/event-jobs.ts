import { type JobsOptions } from 'bullmq';

// The retry schedule of a delivery to an event consumer (`events.<module>`). A consumer fails
// because something it needs is briefly out (Postgres failing over, a lock held by a long
// transaction, a deploy restarting the worker), so it keeps trying for longer than the queue
// default of five attempts from 2 s (about 30 s): eight attempts, the delay doubling from 10 s,
// wait 10 + 20 + 40 + 80 + 160 + 320 + 640 = 1,270 s, about 21 minutes, before the delivery is
// dead-lettered. Consumers are idempotent, so every attempt is safe.
export const EVENT_JOB_ATTEMPTS = 8;
export const EVENT_JOB_BACKOFF_MS = 10_000;

export const EVENT_JOB_OPTIONS = {
  attempts: EVENT_JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: EVENT_JOB_BACKOFF_MS },
} as const satisfies JobsOptions;

// One job per event and consumer: a batch sent twice (Redis took it, the commit failed) adds
// nothing the second time.
export const eventJobId = (eventId: string, consumer: string): string => `${eventId}.${consumer}`;
