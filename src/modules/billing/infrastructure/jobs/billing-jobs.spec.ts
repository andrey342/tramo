import { type CommandBus } from '@nestjs/cqrs';
import { type Job, type Queue } from 'bullmq';

import { CalendarDate } from '@shared/domain';

import { CollectDueChargesCommand } from '../../application/commands/collect-due-charges.command';
import { RunBillingCycleCommand } from '../../application/commands/run-billing-cycle.command';

import {
  BillingCycleJobs,
  BillingCycleProcessor,
  BillingSchedules,
  type CollectionJob,
  CollectionJobs,
  type RebillJob,
} from './billing-jobs';

describe('BillingSchedules', () => {
  // The 1st bills the instalments of the month; the 5th the ISA months whose declarations closed.
  it('should run the cycle on the 1st and on the day ISA declarations close', async () => {
    const patterns = new Map<string, string>();
    const queue = {
      upsertJobScheduler: (name: string, repeat: { pattern: string }) => {
        patterns.set(name, repeat.pattern);
        return Promise.resolve();
      },
    } as unknown as Queue;

    await new BillingSchedules(queue, queue, queue, queue).onApplicationBootstrap();

    expect(patterns.get('monthly-cycle')).toBe('0 3 1,5 * *');
    expect(patterns.get('declaration-reminder')).toBe('0 9 25 * *');
  });
});

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

describe('BillingCycleJobs', () => {
  it('should queue one rebill per event, so a redelivery queues nothing new', async () => {
    const added: { name: string; data: RebillJob; jobId: string | undefined }[] = [];
    const queue = {
      add: (name: string, data: RebillJob, options: { jobId?: string }) => {
        added.push({ name, data, jobId: options.jobId });
        return Promise.resolve();
      },
    } as unknown as Queue<RebillJob>;
    const jobs = new BillingCycleJobs(queue);
    const request = { contractId: 'contract-1', asOf: CalendarDate.parse('2026-11-22') };

    await jobs.rebill({ ...request, eventId: 'event-1' }, 'req-1');
    await jobs.rebill({ ...request, eventId: 'event-1' }, 'req-1');
    await jobs.rebill({ ...request, eventId: 'event-2' }, null);

    expect(added[0]).toEqual({
      name: 'contract.rebill',
      data: { contractId: 'contract-1', asOf: '2026-11-22', correlationId: 'req-1' },
      jobId: 'contract-1.rebill.event-1',
    });
    expect(new Set(added.map((job) => job.jobId)).size).toBe(2);
  });
});

describe('BillingCycleProcessor', () => {
  const contractId = 'contract-1';
  const day = CalendarDate.parse('2026-11-22');

  // Runs a rebill job through the processor, the commands answering in turn.
  function rebill(answers: readonly unknown[]) {
    const executed: unknown[] = [];
    const commands = {
      execute: (command: unknown) => {
        executed.push(command);
        return Promise.resolve(answers[executed.length - 1]);
      },
    } as unknown as CommandBus;
    const processor = new BillingCycleProcessor(commands);
    Object.assign(processor, {
      cls: { run: (work: () => unknown) => work(), set: () => undefined },
    });
    const job = {
      name: 'contract.rebill',
      queueName: 'billing.cycle',
      id: 'contract-1.rebill.event-1',
      data: { contractId, asOf: day.toString(), correlationId: null },
    } as unknown as Job<RebillJob>;
    const run = processor.process(job);
    return { run, executed };
  }

  it('should bill the contract as of the day asked for, then collect what is due', async () => {
    const { run, executed } = rebill([{ failedContractIds: [] }, { failedChargeIds: [] }]);

    await run;

    expect(executed).toEqual([
      new RunBillingCycleCommand(day, contractId),
      new CollectDueChargesCommand(day, contractId),
    ]);
  });

  it('should fail the job when a charge of the contract could not be submitted', async () => {
    const { run } = rebill([{ failedContractIds: [] }, { failedChargeIds: ['charge-1'] }]);

    await expect(run).rejects.toThrow('1 charges not submitted: charge-1');
  });

  it('should fail the job without collecting when the plan could not be billed', async () => {
    const { run, executed } = rebill([{ failedContractIds: [contractId] }]);

    await expect(run).rejects.toThrow('plans not billed');
    expect(executed).toEqual([new RunBillingCycleCommand(day, contractId)]);
  });
});
