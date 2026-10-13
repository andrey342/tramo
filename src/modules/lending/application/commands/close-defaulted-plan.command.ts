import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { FINANCING_PLAN_REPOSITORY, type FinancingPlanRepository } from '../../domain';

// The contract defaulted: its plan is closed (`defaulted`), so the schedule no longer shows it
// active and billing no longer bills it. Run after ContractDefaulted; a redelivery, or a plan
// that ended before, changes nothing.
export class CloseDefaultedPlanCommand extends Command<void> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(CloseDefaultedPlanCommand)
export class CloseDefaultedPlanHandler implements ICommandHandler<CloseDefaultedPlanCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_PLAN_REPOSITORY) private readonly plans: FinancingPlanRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CloseDefaultedPlanCommand): Promise<void> {
    await this.uow.run(async () => {
      // A contract defaults only once active, after its plan opened; without one there is
      // nothing to close.
      const plan = await this.plans.findByContractId(command.contractId);
      if (!plan) {
        return;
      }
      plan.closeOnDefault(this.clock.now());
      if (plan.hasPendingEvents) {
        await this.plans.save(plan);
      }
    });
  }
}
