import { getQueueToken } from '@nestjs/bullmq';
import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { type Queue, Worker } from 'bullmq';

import { CoreModule } from '@shared/infrastructure/core.module';
import { QueueNames } from '@shared/infrastructure/queues';

import { REBUILD_JOBS, type RebuildJobs } from '../../application/ports/reporting-ports';
import { ReportingModule } from '../../reporting.module';

describe('QueuedRebuildJobs (integration)', () => {
  let app: INestApplicationContext;
  let jobs: RebuildJobs;
  let queue: Queue;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), ReportingModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    jobs = app.get(REBUILD_JOBS);
    queue = app.get<Queue>(getQueueToken(QueueNames.REPORTING_REBUILD));
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  it('should queue one rebuild at a time', async () => {
    const first = await jobs.request('ops-1');
    const second = await jobs.request('ops-2');

    expect([first, second]).toEqual([true, false]);
    expect(await queue.getJobCounts('waiting')).toEqual({ waiting: 1 });
  });

  it('should queue a new rebuild when a finished one still holds the id', async () => {
    await queue.add(
      'reporting.rebuild',
      { requestedBy: null, correlationId: null },
      {
        jobId: 'reporting.rebuild',
      },
    );
    // Processed by hand, as a worker of an older version kept finished jobs.
    const worker = new Worker(queue.name, null, {
      connection: queue.opts.connection,
      prefix: queue.opts.prefix,
    });
    const kept = await worker.getNextJob('token');
    await kept.moveToCompleted('done', 'token', false);
    await worker.close();
    expect(await queue.getJobState('reporting.rebuild')).toBe('completed');

    const queued = await jobs.request('ops-1');

    expect(queued).toBe(true);
    expect(await queue.getJobState('reporting.rebuild')).toBe('waiting');
  });
});
