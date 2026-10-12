import { type Queue } from 'bullmq';

import { type CollectionJob, CollectionJobs } from './billing-jobs';

describe('CollectionJobs', () => {
  // BullMQ ignores a job whose id it still holds, even a failed one: a resubmission needs its own.
  it('should queue each submission of an attempt as its own job, under the same key', async () => {
    const added: { data: CollectionJob; jobId: string | undefined }[] = [];
    const queue = {
      add: (_name: string, data: CollectionJob, options: { jobId?: string }) => {
        added.push({ data, jobId: options.jobId });
        return Promise.resolve();
      },
    } as unknown as Queue<CollectionJob>;
    const jobs = new CollectionJobs(queue);
    const submission = { chargeId: 'charge-1', attemptKey: 'charge-1.1' };

    await jobs.collect({ ...submission, eventId: 'event-1' }, null);
    await jobs.collect({ ...submission, eventId: 'event-2' }, null);

    expect(added.map((job) => job.data.attemptKey)).toEqual(['charge-1.1', 'charge-1.1']);
    expect(new Set(added.map((job) => job.jobId)).size).toBe(2);
  });
});
