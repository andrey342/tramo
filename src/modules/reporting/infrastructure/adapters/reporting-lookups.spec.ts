import { Logger } from '@nestjs/common';
import { type Queue } from 'bullmq';

import { QUEUE_CALL_TIMEOUT_MS } from '@shared/infrastructure/queues';

import { BullQueueHealth } from './reporting-lookups';

describe('BullQueueHealth', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const healthWith = (getJobCounts: () => Promise<Record<string, number>>) =>
    new BullQueueHealth({ getJobCounts } as unknown as Queue);

  it('should count the dead letters waiting for someone when Redis answers', async () => {
    const health = healthWith(() => Promise.resolve({ waiting: 3, delayed: 1 }));

    expect(await health.deadLetters()).toBe(4);
  });

  // The queue connection waits for Redis to come back instead of failing.
  it('should give up and answer null when Redis does not answer in time', async () => {
    jest.useFakeTimers();
    const health = healthWith(() => new Promise(() => undefined));

    const count = health.deadLetters();
    await jest.advanceTimersByTimeAsync(QUEUE_CALL_TIMEOUT_MS);

    expect(await count).toBeNull();
  });

  it('should not ask Redis again when an earlier count is still waiting', async () => {
    jest.useFakeTimers();
    let reads = 0;
    const health = healthWith(() => {
      reads += 1;
      return new Promise(() => undefined);
    });

    for (let request = 0; request < 3; request += 1) {
      const count = health.deadLetters();
      await jest.advanceTimersByTimeAsync(QUEUE_CALL_TIMEOUT_MS);
      expect(await count).toBeNull();
    }

    expect(reads).toBe(1);
  });
});
