import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Job, type JobsOptions, type Queue } from 'bullmq';

import { CalendarDate } from '@shared/domain';
import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { CollectDueChargesCommand } from '../../application/commands/collect-due-charges.command';
import { ExecuteChargeCollectionCommand } from '../../application/commands/execute-charge-collection.command';
import { RunBillingCycleCommand } from '../../application/commands/run-billing-cycle.command';
import { RunDunningCommand } from '../../application/commands/run-dunning.command';
import { SendDeclarationRemindersCommand } from '../../application/commands/send-declaration-reminders.command';
import { ISA_DUE_DAY } from '../../domain';

export interface CollectionJob extends CorrelatedJobData {
  readonly chargeId: string;
  readonly attemptKey: string;
}

// One contract billed and collected as of a day, outside the scheduled runs.
export interface RebillJob extends CorrelatedJobData {
  readonly contractId: string;
  readonly asOf: string;
}

const COLLECT_DUE = 'collect.due';
const COLLECT_CHARGE = 'charge.collect';
const REBILL_CONTRACT = 'contract.rebill';

// A provider outage is retried for about two hours (exponential from 30 s over nine attempts),
// then dead-lettered; the charge stays pending with its key (dunning leaves it alone) until ops
// ask the provider again with the same key (POST /charges/:id/retry).
const PROVIDER_CALL: JobsOptions = { attempts: 9, backoff: { type: 'exponential', delay: 30_000 } };

// The calendar of billing, in UTC: the cycle on the 1st (the instalments of the month) and on
// the 5th (the ISA months whose declarations closed that day; a run repeats nothing), collection
// and dunning every morning, the ISA declaration reminder on the 25th. Upserted by name on every
// worker start: one schedule each.
const SCHEDULES = [
  {
    queue: QueueNames.BILLING_CYCLE,
    name: 'monthly-cycle',
    pattern: `0 3 1,${String(ISA_DUE_DAY)} * *`,
  },
  { queue: QueueNames.BILLING_COLLECT, name: 'daily-collection', pattern: '0 6 * * *' },
  { queue: QueueNames.BILLING_DUNNING, name: 'daily-dunning', pattern: '0 7 * * *' },
  { queue: QueueNames.DECLARATION_REMINDERS, name: 'declaration-reminder', pattern: '0 9 25 * *' },
] as const;

@Injectable()
export class BillingSchedules implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(QueueNames.BILLING_CYCLE) private readonly cycle: Queue,
    @InjectQueue(QueueNames.BILLING_COLLECT) private readonly collect: Queue,
    @InjectQueue(QueueNames.BILLING_DUNNING) private readonly dunning: Queue,
    @InjectQueue(QueueNames.DECLARATION_REMINDERS) private readonly reminders: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const queues: Record<string, Queue> = {
      [QueueNames.BILLING_CYCLE]: this.cycle,
      [QueueNames.BILLING_COLLECT]: this.collect,
      [QueueNames.BILLING_DUNNING]: this.dunning,
      [QueueNames.DECLARATION_REMINDERS]: this.reminders,
    };
    for (const schedule of SCHEDULES) {
      await queues[schedule.queue]?.upsertJobScheduler(
        schedule.name,
        { pattern: schedule.pattern, tz: 'UTC' },
        { name: schedule.queue === QueueNames.BILLING_COLLECT ? COLLECT_DUE : schedule.name },
      );
    }
  }
}

// Queues the provider call of one submission of a collection attempt (its ChargeSubmitted): a
// redelivered event queues nothing new, an attempt submitted again (ops, after its job was
// dead-lettered) queues a new job. The provider sees the same attempt key either way.
@Injectable()
export class CollectionJobs {
  constructor(
    @InjectQueue(QueueNames.BILLING_COLLECT) private readonly queue: Queue<CollectionJob>,
  ) {}

  async collect(
    submission: {
      readonly chargeId: string;
      readonly attemptKey: string;
      readonly eventId: string;
    },
    correlationId: string | null,
  ): Promise<void> {
    const { chargeId, attemptKey, eventId } = submission;
    await this.queue.add(
      COLLECT_CHARGE,
      { chargeId, attemptKey, correlationId },
      { ...PROVIDER_CALL, jobId: `${attemptKey}.collect.${eventId}` },
    );
  }
}

// Queues the billing of one contract that the cycle skipped while a payoff was being collected
// (its PayoffWithdrawn), keyed by the event: a redelivery queues nothing new while BullMQ holds
// the job, and billing and collecting again find the work done. The job runs outside the
// event's transaction, so each plan and charge gets its own, as in the scheduled runs.
@Injectable()
export class BillingCycleJobs {
  constructor(@InjectQueue(QueueNames.BILLING_CYCLE) private readonly queue: Queue<RebillJob>) {}

  async rebill(
    request: { readonly contractId: string; readonly asOf: CalendarDate; readonly eventId: string },
    correlationId: string | null,
  ): Promise<void> {
    const { contractId, asOf, eventId } = request;
    await this.queue.add(
      REBILL_CONTRACT,
      { contractId, asOf: asOf.toString(), correlationId },
      { jobId: `${contractId}.rebill.${eventId}` },
    );
  }
}

// Each scheduled run works as of the day it runs; a rebill as of the day it was asked for, then
// collects what it charged. A failed plan or charge fails the job, which is retried.
@Processor(QueueNames.BILLING_CYCLE)
export class BillingCycleProcessor extends QueueProcessor<RebillJob | CorrelatedJobData> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<RebillJob | CorrelatedJobData>): Promise<unknown> {
    if (job.name === REBILL_CONTRACT && 'contractId' in job.data) {
      return this.rebill(job.data);
    }
    const result = await this.commands.execute(
      new RunBillingCycleCommand(CalendarDate.fromInstant(this.clock.now())),
    );
    return failIfAny(result, result.failedContractIds, 'plans not billed');
  }

  private async rebill({ contractId, asOf }: RebillJob): Promise<unknown> {
    const day = CalendarDate.parse(asOf);
    const billed = await this.commands.execute(new RunBillingCycleCommand(day, contractId));
    failIfAny(billed, billed.failedContractIds, 'plans not billed');
    const collected = await this.commands.execute(new CollectDueChargesCommand(day, contractId));
    failIfAny(collected, collected.failedChargeIds, 'charges not submitted');
    return { billed, collected };
  }
}

@Processor(QueueNames.BILLING_COLLECT, { concurrency: 10 })
export class CollectionProcessor extends QueueProcessor<CollectionJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(job: Job<CollectionJob>): Promise<unknown> {
    if (job.name === COLLECT_CHARGE) {
      await this.commands.execute(
        new ExecuteChargeCollectionCommand(job.data.chargeId, job.data.attemptKey),
      );
      return 'requested';
    }
    const result = await this.commands.execute(
      new CollectDueChargesCommand(CalendarDate.fromInstant(this.clock.now())),
    );
    return failIfAny(result, result.failedChargeIds, 'charges not submitted');
  }
}

@Processor(QueueNames.BILLING_DUNNING)
export class DunningProcessor extends QueueProcessor {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(): Promise<unknown> {
    const result = await this.commands.execute(
      new RunDunningCommand(CalendarDate.fromInstant(this.clock.now())),
    );
    return failIfAny(result, result.failedChargeIds, 'charges not dunned');
  }
}

@Processor(QueueNames.DECLARATION_REMINDERS)
export class DeclarationReminderProcessor extends QueueProcessor {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected handle(): Promise<unknown> {
    return this.commands.execute(
      new SendDeclarationRemindersCommand(CalendarDate.fromInstant(this.clock.now())),
    );
  }
}

// A run goes on past the items that fail (each rolled back on its own), then fails as a whole:
// the job shows on the dashboard and is retried, and a retry skips what is done.
function failIfAny<T>(result: T, failed: readonly string[], what: string): T {
  if (failed.length > 0) {
    throw new Error(`${String(failed.length)} ${what}: ${failed.join(', ')}`);
  }
  return result;
}
