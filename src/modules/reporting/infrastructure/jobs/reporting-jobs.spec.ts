import { type Queue } from 'bullmq';

import { QUEUE_CALL_TIMEOUT_MS, QueueUnreachableError } from '@shared/infrastructure/queues';

import { QueuedRebuildJobs } from './reporting-jobs';

describe('QueuedRebuildJobs', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // The queue connection waits for Redis to come back instead of failing.
  it('should give up with QueueUnreachableError when Redis does not answer in time', async () => {
    jest.useFakeTimers();
    const queue = { getJob: () => new Promise(() => undefined) } as unknown as Queue;
    const jobs = new QueuedRebuildJobs(queue);

    const settled = expect(jobs.request('ops-1')).rejects.toThrow(QueueUnreachableError);
    await jest.advanceTimersByTimeAsync(QUEUE_CALL_TIMEOUT_MS);

    await settled;
  });

  it('should queue one rebuild when none is waiting', async () => {
    const added: string[] = [];
    const queue = {
      getJob: () => Promise.resolve(undefined),
      add: (name: string) => {
        added.push(name);
        return Promise.resolve();
      },
    } as unknown as Queue;

    expect(await new QueuedRebuildJobs(queue).request('ops-1')).toBe(true);
    expect(added).toEqual(['reporting.rebuild']);
  });
});
