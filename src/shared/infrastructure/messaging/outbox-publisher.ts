import { getQueueToken } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { type JobsOptions, type Queue } from 'bullmq';
import { DataSource, type EntityManager } from 'typeorm';

import { type IntegrationEvent } from '@shared/application';

import { APP_CONFIG, type AppConfig } from '../config';

import { EventSubscriptionRegistry } from './event-subscription.registry';

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: IntegrationEvent['payload'];
  occurred_at: Date;
  correlation_id: string | null;
}

interface PendingJob {
  name: string;
  data: IntegrationEvent;
  opts: JobsOptions;
}

const MAX_BACKOFF_MS = 30_000;

// Moves committed events from shared.outbox_messages to the subscribers' queues (ADR 004).
// Rows are claimed with FOR UPDATE SKIP LOCKED, so several workers can publish in parallel without
// sending a row twice. If Redis accepts the jobs but the commit fails, the rows are sent again on
// the next pass; job ids (`<eventId>.<consumer>`) and consumer idempotency absorb the duplicate.
@Injectable()
export class OutboxPublisher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly registry: EventSubscriptionRegistry,
    private readonly moduleRef: ModuleRef,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.outbox.enabled) {
      this.schedule(0);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.inFlight;
  }

  // Publishes one batch and returns how many outbox rows it handled.
  async publishBatch(): Promise<number> {
    let claimedIds: string[] = [];
    try {
      return await this.dataSource.transaction(async (manager) => {
        const rows = await this.claimBatch(manager);
        claimedIds = rows.map((row) => row.id);
        if (rows.length === 0) {
          return 0;
        }
        await this.enqueue(rows);
        await manager.query(
          `UPDATE shared.outbox_messages
             SET published_at = now(), attempts = attempts + 1, last_error = NULL
           WHERE id = ANY($1::uuid[])`,
          [claimedIds],
        );
        return rows.length;
      });
    } catch (error) {
      await this.recordFailure(claimedIds, error);
      throw error;
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      this.inFlight = this.drain().then((nextDelay) => {
        this.schedule(nextDelay);
      });
    }, delayMs);
  }

  // Publishes until the outbox is empty, then waits for the poll interval. On errors (Redis or
  // Postgres down) it backs off exponentially up to 30 s.
  private async drain(): Promise<number> {
    const { batchSize, pollIntervalMs } = this.config.outbox;
    try {
      let published: number;
      do {
        published = await this.publishBatch();
      } while (published === batchSize && !this.stopped);
      this.failures = 0;
      return pollIntervalMs;
    } catch (error) {
      this.failures += 1;
      const delay = Math.min(pollIntervalMs * 2 ** this.failures, MAX_BACKOFF_MS);
      this.logger.warn({ err: errorMessage(error), retryInMs: delay }, 'Outbox publish failed');
      return delay;
    }
  }

  private claimBatch(manager: EntityManager): Promise<OutboxRow[]> {
    return manager.query(
      `SELECT id, aggregate_type, aggregate_id, event_type, payload, occurred_at, correlation_id
         FROM shared.outbox_messages
        WHERE published_at IS NULL
        ORDER BY id
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [this.config.outbox.batchSize],
    );
  }

  private async enqueue(rows: readonly OutboxRow[]): Promise<void> {
    const byQueue = new Map<string, PendingJob[]>();
    for (const row of rows) {
      const event = toIntegrationEvent(row);
      for (const subscriber of this.registry.subscribersOf(row.event_type)) {
        const jobs = byQueue.get(subscriber.queue) ?? [];
        jobs.push({
          name: subscriber.consumer,
          data: event,
          opts: { jobId: `${row.id}.${subscriber.consumer}` },
        });
        byQueue.set(subscriber.queue, jobs);
      }
    }
    await Promise.all([...byQueue].map(([queue, jobs]) => this.queue(queue).addBulk(jobs)));
  }

  private queue(name: string): Queue {
    return this.moduleRef.get<Queue>(getQueueToken(name), { strict: false });
  }

  private async recordFailure(ids: readonly string[], error: unknown): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    await this.dataSource
      .query(
        `UPDATE shared.outbox_messages SET attempts = attempts + 1, last_error = $2
          WHERE id = ANY($1::uuid[]) AND published_at IS NULL`,
        [ids, errorMessage(error).slice(0, 1000)],
      )
      .catch(() => undefined);
  }
}

function toIntegrationEvent(row: OutboxRow): IntegrationEvent {
  return {
    eventId: row.id,
    eventType: row.event_type,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    occurredAt: row.occurred_at.toISOString(),
    correlationId: row.correlation_id,
    payload: row.payload,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
