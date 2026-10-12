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

export interface CollectionJob extends CorrelatedJobData {
  readonly chargeId: string;
  readonly attemptKey: string;
}

const COLLECT_DUE = 'collect.due';
const COLLECT_CHARGE = 'charge.collect';

// A provider outage is retried for about two hours (exponential from 30 s over nine attempts),
// then dead-lettered; the charge stays pending with its key, and ops retry or dunning moves on.
const PROVIDER_CALL: JobsOptions = { attempts: 9, backoff: { type: 'exponential', delay: 30_000 } };

// The calendar of billing, in UTC: the cycle on the 1st, collection and dunning every morning,
// the ISA declaration reminder on the 25th. Upserted by name on every worker start: one schedule.
const SCHEDULES = [
  { queue: QueueNames.BILLING_CYCLE, name: 'monthly-cycle', pattern: '0 3 1 * *' },
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

// Queues the provider call of one collection attempt, keyed by it: a redelivered ChargeSubmitted
// queues nothing new.
@Injectable()
export class CollectionJobs {
  constructor(
    @InjectQueue(QueueNames.BILLING_COLLECT) private readonly queue: Queue<CollectionJob>,
  ) {}

  async collect(chargeId: string, attemptKey: string, correlationId: string | null): Promise<void> {
    await this.queue.add(
      COLLECT_CHARGE,
      { chargeId, attemptKey, correlationId },
      { ...PROVIDER_CALL, jobId: `${attemptKey}.collect` },
    );
  }
}

// Each scheduled run works as of the day it runs.
@Processor(QueueNames.BILLING_CYCLE)
export class BillingCycleProcessor extends QueueProcessor {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected async handle(): Promise<unknown> {
    const result = await this.commands.execute(
      new RunBillingCycleCommand(CalendarDate.fromInstant(this.clock.now())),
    );
    return failIfAny(result, result.failedContractIds, 'plans not billed');
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
