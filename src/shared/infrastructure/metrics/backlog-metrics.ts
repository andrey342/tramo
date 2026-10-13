import { getQueueToken } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type Queue } from 'bullmq';
import { Gauge, type Registry } from 'prom-client';
import { DataSource } from 'typeorm';

import { ALL_QUEUES } from '../queues';

import { METRICS_REGISTRY } from './metrics-registry';

const JOB_STATES = ['waiting', 'active', 'delayed', 'failed'] as const;

interface OutboxBacklog {
  readonly pending: number;
  readonly lagSeconds: number;
}

// Read when Prometheus scrapes, from where the work waits: the jobs of every queue by state, and
// the events the outbox has not handed to the queues yet with the age of the oldest one (the
// publisher's lag). A source that cannot be read leaves its series out of that scrape.
@Injectable()
export class BacklogMetrics {
  private readonly logger = new Logger(BacklogMetrics.name);
  // Both outbox gauges are collected in the same scrape; they share one query.
  private outboxRead: Promise<OutboxBacklog | null> | null = null;

  constructor(
    @Inject(METRICS_REGISTRY) registry: Registry,
    private readonly modules: ModuleRef,
    private readonly db: DataSource,
  ) {
    const jobs: Gauge<'queue' | 'state'> = new Gauge({
      name: 'tramo_queue_jobs',
      help: 'Jobs in each queue by state.',
      labelNames: ['queue', 'state'],
      registers: [registry],
      collect: async () => {
        jobs.reset();
        for (const [queue, counts] of await this.jobCounts()) {
          for (const state of JOB_STATES) jobs.set({ queue, state }, counts[state] ?? 0);
        }
      },
    });
    const pending: Gauge = new Gauge({
      name: 'tramo_outbox_pending_events',
      help: 'Events recorded in the outbox and not yet published to the queues.',
      registers: [registry],
      collect: async () => {
        pending.reset();
        const backlog = await this.outbox();
        if (backlog) pending.set(backlog.pending);
      },
    });
    const lag: Gauge = new Gauge({
      name: 'tramo_outbox_lag_seconds',
      help: 'Age of the oldest unpublished outbox event; 0 when none waits.',
      registers: [registry],
      collect: async () => {
        lag.reset();
        const backlog = await this.outbox();
        if (backlog) lag.set(backlog.lagSeconds);
      },
    });
  }

  private async jobCounts(): Promise<[string, Record<string, number>][]> {
    try {
      return await Promise.all(
        ALL_QUEUES.map(async (name): Promise<[string, Record<string, number>]> => {
          const queue = this.modules.get<Queue>(getQueueToken(name), { strict: false });
          return [name, await queue.getJobCounts(...JOB_STATES)];
        }),
      );
    } catch (error) {
      this.logger.warn({ err: error }, 'Queue metrics unavailable');
      return [];
    }
  }

  private outbox(): Promise<OutboxBacklog | null> {
    this.outboxRead ??= this.readOutbox().finally(() => {
      this.outboxRead = null;
    });
    return this.outboxRead;
  }

  private async readOutbox(): Promise<OutboxBacklog | null> {
    try {
      const [row] = await this.db.query<{ pending: string; lag: string | null }[]>(
        `SELECT COUNT(*) AS pending, EXTRACT(EPOCH FROM now() - MIN(occurred_at)) AS lag
           FROM shared.outbox_messages WHERE published_at IS NULL`,
      );
      return {
        pending: Number(row?.pending ?? 0),
        lagSeconds: Math.max(0, Number(row?.lag ?? 0)),
      };
    } catch (error) {
      this.logger.warn({ err: error }, 'Outbox metrics unavailable');
      return null;
    }
  }
}
