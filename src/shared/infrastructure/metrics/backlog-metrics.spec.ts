import { type ModuleRef } from '@nestjs/core';
import { Registry } from 'prom-client';

import { type OutboxBacklogReader } from '../messaging/outbox-backlog';
import { ALL_QUEUES } from '../queues';

import { BacklogMetrics } from './backlog-metrics';

describe('BacklogMetrics', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  const metricsWith = (getJobCounts: () => Promise<Record<string, number>>) => {
    const registry = new Registry();
    const modules = { get: () => ({ getJobCounts }) } as unknown as ModuleRef;
    const outbox = {
      read: () => Promise.resolve({ pending: 3, lagSeconds: 1.5 }),
    } as unknown as OutboxBacklogReader;
    new BacklogMetrics(registry, modules, outbox);
    return registry;
  };

  // The queue connection waits for Redis to come back instead of failing.
  it('should answer without the queue series when Redis does not answer', async () => {
    jest.useFakeTimers();
    const registry = metricsWith(() => new Promise(() => undefined));

    const scrape = registry.metrics();
    await jest.advanceTimersByTimeAsync(5_000);
    const text = await scrape;

    expect(text).not.toMatch(/tramo_queue_jobs\{/);
    expect(text).toContain('tramo_outbox_pending_events 3');
    expect(text).toContain('tramo_outbox_lag_seconds 1.5');
  });

  // The connection keeps commands queued while Redis is down: one read at a time, not one per
  // scrape.
  it('should not ask the queues again while an earlier read is still waiting', async () => {
    jest.useFakeTimers();
    let reads = 0;
    const registry = metricsWith(() => {
      reads += 1;
      return new Promise(() => undefined);
    });

    for (let scrape = 0; scrape < 3; scrape += 1) {
      const text = registry.metrics();
      await jest.advanceTimersByTimeAsync(6_000);
      await text;
    }

    expect(reads).toBe(ALL_QUEUES.length);
  });

  it('should report every queue by state when Redis answers', async () => {
    const registry = metricsWith(() =>
      Promise.resolve({ waiting: 2, active: 1, delayed: 0, failed: 4 }),
    );

    const text = await registry.metrics();

    expect(text).toContain('tramo_queue_jobs{queue="events.billing",state="waiting"} 2');
    expect(text).toContain('tramo_queue_jobs{queue="dead-letter",state="failed"} 4');
  });
});
