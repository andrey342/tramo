import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type Queue } from 'bullmq';
import { Gauge, type Registry } from 'prom-client';

import { type OutboxBacklog, OutboxBacklogReader } from '../messaging/outbox-backlog';
import { ALL_QUEUES } from '../queues';

import { METRICS_REGISTRY } from './metrics-registry';

const JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;
// The queue connection waits for Redis to come back instead of failing, so each source is given
// up after this long; a scrape then still answers, without that source's series.
const SOURCE_TIMEOUT_MS = 5_000;
// Scrapes within this window share one read of Redis and Postgres.
const CACHE_MS = 5_000;

type JobCounts = readonly [queue: string, counts: Readonly<Record<string, number>>][];

interface Backlog {
  readonly jobs: JobCounts | null;
  readonly outbox: OutboxBacklog | null;
}

// Read when Prometheus scrapes, from where the work waits: the jobs of every queue by state, and
// the events the outbox has not handed to the queues yet with the age of the oldest one (the
// publisher's lag). A source that cannot be read in time leaves its series out of that scrape.
@Injectable()
export class BacklogMetrics {
  private readonly logger = new Logger(BacklogMetrics.name);
  private cached: { readonly at: number; readonly backlog: Promise<Backlog> } | null = null;
  // A read of the queues still waiting for Redis (the connection queues commands while Redis is
  // down): no new one is issued until it settles, so an outage does not pile commands up.
  private jobsInFlight = false;

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly modules: ModuleRef,
    private readonly outboxBacklog: OutboxBacklogReader,
  ) {
    // Each gauge is filled from one finished read, in one synchronous pass, so overlapping
    // scrapes never see it half written.
    const jobs: Gauge<'queue' | 'state'> = new Gauge({
      name: 'tramo_queue_jobs',
      help: 'Jobs in each queue by state.',
      labelNames: ['queue', 'state'],
      registers: [registry],
      collect: async () => {
        const counts = (await this.backlog()).jobs;
        jobs.reset();
        for (const [queue, byState] of counts ?? []) {
          for (const state of JOB_STATES) jobs.set({ queue, state }, byState[state] ?? 0);
        }
      },
    });
    const pending: Gauge = new Gauge({
      name: 'tramo_outbox_pending_events',
      help: 'Events recorded in the outbox and not yet published to the queues (up to 10000).',
      registers: [registry],
      collect: async () => {
        const outbox = (await this.backlog()).outbox;
        pending.reset();
        if (outbox) pending.set(outbox.pending);
      },
    });
    const lag: Gauge = new Gauge({
      name: 'tramo_outbox_lag_seconds',
      help: 'Age of the oldest unpublished outbox event; 0 when none waits.',
      registers: [registry],
      collect: async () => {
        const outbox = (await this.backlog()).outbox;
        lag.reset();
        if (outbox) lag.set(outbox.lagSeconds);
      },
    });
  }

  private backlog(): Promise<Backlog> {
    const now = Date.now();
    if (!this.cached || now - this.cached.at >= CACHE_MS) {
      this.cached = { at: now, backlog: this.read() };
    }
    return this.cached.backlog;
  }

  private async read(): Promise<Backlog> {
    const [jobs, outbox] = await Promise.all([
      this.jobsInFlight ? null : this.withinTimeout('Queue', this.trackedJobCounts()),
      this.withinTimeout('Outbox', this.outboxBacklog.read()),
    ]);
    return { jobs, outbox };
  }

  private trackedJobCounts(): Promise<JobCounts> {
    this.jobsInFlight = true;
    return this.jobCounts().finally(() => {
      this.jobsInFlight = false;
    });
  }

  private jobCounts(): Promise<JobCounts> {
    return Promise.all(
      ALL_QUEUES.map(async (name) => {
        const queue = this.modules.get<Queue>(getQueueToken(name), { strict: false });
        return [name, await queue.getJobCounts(...JOB_STATES)] as const;
      }),
    );
  }

  private async withinTimeout<T>(source: string, read: Promise<T>): Promise<T | null> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<null>((resolve) => {
      timer = setTimeout(() => {
        resolve(null);
      }, SOURCE_TIMEOUT_MS);
    });
    try {
      const value = await Promise.race([read, timeout]);
      if (value === null) this.logger.warn(`${source} metrics timed out`);
      return value;
    } catch (error) {
      this.logger.warn({ err: error }, `${source} metrics unavailable`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
