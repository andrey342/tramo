import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { type CalendarDate } from '@shared/domain';

import { assertStaff } from '../billing-access';
import { type BillingRunDto, type DunningRunDto } from '../dto/billing.dto';

import { CollectDueChargesCommand, CollectDueChargesHandler } from './collect-due-charges.command';
import { RunBillingCycleCommand, RunBillingCycleHandler } from './run-billing-cycle.command';
import { RunDunningCommand, RunDunningHandler } from './run-dunning.command';

// Ops run billing by hand, as of a day: to catch up after an outage, or to walk the demo through
// the months. The cycle, then the collection of what it made due.
export class RunBillingNowCommand extends Command<BillingRunDto> {
  constructor(
    readonly actor: Principal,
    readonly asOf: CalendarDate,
  ) {
    super();
  }
}

@CommandHandler(RunBillingNowCommand)
export class RunBillingNowHandler implements ICommandHandler<RunBillingNowCommand> {
  constructor(
    private readonly cycle: RunBillingCycleHandler,
    private readonly collection: CollectDueChargesHandler,
  ) {}

  async execute(command: RunBillingNowCommand): Promise<BillingRunDto> {
    assertStaff(command.actor);
    const billed = await this.cycle.execute(new RunBillingCycleCommand(command.asOf));
    const submitted = await this.collection.execute(new CollectDueChargesCommand(command.asOf));
    return {
      asOf: command.asOf.toString(),
      plansBilled: billed.plansBilled,
      chargesCreated: billed.chargesCreated,
      failedContractIds: billed.failedContractIds,
      collectionsSubmitted: submitted.submitted,
    };
  }
}

export class RunDunningNowCommand extends Command<DunningRunDto> {
  constructor(
    readonly actor: Principal,
    readonly asOf: CalendarDate,
  ) {
    super();
  }
}

@CommandHandler(RunDunningNowCommand)
export class RunDunningNowHandler implements ICommandHandler<RunDunningNowCommand> {
  constructor(private readonly dunning: RunDunningHandler) {}

  async execute(command: RunDunningNowCommand): Promise<DunningRunDto> {
    assertStaff(command.actor);
    const { chargesReviewed, retries } = await this.dunning.execute(
      new RunDunningCommand(command.asOf),
    );
    return { asOf: command.asOf.toString(), chargesReviewed, retries };
  }
}
