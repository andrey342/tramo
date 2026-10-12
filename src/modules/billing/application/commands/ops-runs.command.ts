import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditChanges,
  type AuditTrail,
  type Principal,
} from '@shared/application';
import { type CalendarDate } from '@shared/domain';

import { assertStaff } from '../billing-access';
import { type BillingRunDto, type DunningRunDto } from '../dto/billing.dto';

import { CollectDueChargesCommand, CollectDueChargesHandler } from './collect-due-charges.command';
import { RunBillingCycleCommand, RunBillingCycleHandler } from './run-billing-cycle.command';
import { RunDunningCommand, RunDunningHandler } from './run-dunning.command';

// Ops run billing by hand, as of a day (for one contract, when given): to catch up after an
// outage, or to walk the demo through the months. The cycle, then the collection of what it made
// due. The audit entry keeps the day and the contract.
export class RunBillingNowCommand extends Command<BillingRunDto> {
  constructor(
    readonly actor: Principal,
    readonly asOf: CalendarDate,
    readonly contractId: string | null = null,
  ) {
    super();
  }
}

@CommandHandler(RunBillingNowCommand)
export class RunBillingNowHandler implements ICommandHandler<RunBillingNowCommand> {
  constructor(
    private readonly cycle: RunBillingCycleHandler,
    private readonly collection: CollectDueChargesHandler,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async execute(command: RunBillingNowCommand): Promise<BillingRunDto> {
    assertStaff(command.actor);
    const { asOf, contractId } = command;
    this.audit.describeChanges(runScope(asOf, contractId));
    const billed = await this.cycle.execute(new RunBillingCycleCommand(asOf, contractId));
    const collected = await this.collection.execute(new CollectDueChargesCommand(asOf, contractId));
    return {
      asOf: asOf.toString(),
      plansBilled: billed.plansBilled,
      chargesCreated: billed.chargesCreated,
      failedContractIds: billed.failedContractIds,
      collectionsSubmitted: collected.submitted,
      failedChargeIds: collected.failedChargeIds,
    };
  }
}

export class RunDunningNowCommand extends Command<DunningRunDto> {
  constructor(
    readonly actor: Principal,
    readonly asOf: CalendarDate,
    readonly contractId: string | null = null,
  ) {
    super();
  }
}

@CommandHandler(RunDunningNowCommand)
export class RunDunningNowHandler implements ICommandHandler<RunDunningNowCommand> {
  constructor(
    private readonly dunning: RunDunningHandler,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
  ) {}

  async execute(command: RunDunningNowCommand): Promise<DunningRunDto> {
    assertStaff(command.actor);
    const { asOf, contractId } = command;
    this.audit.describeChanges(runScope(asOf, contractId));
    const result = await this.dunning.execute(new RunDunningCommand(asOf, contractId));
    return { asOf: asOf.toString(), ...result };
  }
}

function runScope(asOf: CalendarDate, contractId: string | null): AuditChanges {
  return {
    asOf: { before: null, after: asOf.toString() },
    contractId: { before: null, after: contractId },
  };
}
