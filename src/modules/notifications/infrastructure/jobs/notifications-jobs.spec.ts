import { type Queue } from 'bullmq';

import { NotificationSchedules } from './notifications-jobs';

describe('NotificationSchedules', () => {
  // The next hour's sweep is the retry; five attempts would go over the same rows again.
  it('should schedule the hourly email sweep with one attempt when the worker starts', async () => {
    const upserted: unknown[][] = [];
    const queue = {
      upsertJobScheduler: (...args: unknown[]) => {
        upserted.push(args);
        return Promise.resolve();
      },
    } as unknown as Queue;

    await new NotificationSchedules(queue).onApplicationBootstrap();

    expect(upserted).toEqual([
      [
        'emails.sweep',
        { pattern: '15 * * * *', tz: 'UTC' },
        { name: 'emails.sweep', opts: { attempts: 1 } },
      ],
    ]);
  });
});
