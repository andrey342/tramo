import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { type CalendarDate, CLOCK, type Clock } from '@shared/domain';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
} from '../../domain';

// A contract signed a mandate: every charge of it due by `asOf` and not collected is submitted
// under it, those still scheduled and those dunning could not retry without one (failed,
// overdue). Nothing while a payoff covers them.
export class CollectWaitingChargesCommand extends Command<number> {
  constructor(
    readonly contractId: string,
    readonly asOf: CalendarDate,
  ) {
    super();
  }
}

@CommandHandler(CollectWaitingChargesCommand)
export class CollectWaitingChargesHandler implements ICommandHandler<CollectWaitingChargesCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CollectWaitingChargesCommand): Promise<number> {
    return this.uow.run(async () => {
      await this.charges.lockContract(command.contractId);
      const mandate = await this.mandates.findActiveByContract(command.contractId);
      if (!mandate || (await this.charges.hasPayoff(command.contractId))) {
        return 0;
      }
      let submitted = 0;
      for (const charge of await this.charges.findOpen(command.contractId)) {
        if (!charge.collectible || charge.dueDate.isAfter(command.asOf)) {
          continue;
        }
        charge.submitCollection(mandate.id, this.clock.now());
        await this.charges.save(charge);
        submitted += 1;
      }
      return submitted;
    });
  }
}
