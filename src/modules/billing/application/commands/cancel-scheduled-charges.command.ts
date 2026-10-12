import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { CHARGE_REPOSITORY, type ChargeRepository } from '../../domain';

// A plan ended (paid off) or its contract defaulted: charges not yet in collection are no longer
// owed. Those being collected are left to the provider's answer.
export class CancelScheduledChargesCommand extends Command<number> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(CancelScheduledChargesCommand)
export class CancelScheduledChargesHandler implements ICommandHandler<CancelScheduledChargesCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CancelScheduledChargesCommand): Promise<number> {
    return this.uow.run(async () => {
      const ids = await this.charges.findScheduledIds(command.contractId);
      for (const id of ids) {
        const charge = await this.charges.findById(id);
        if (charge?.status === 'scheduled') {
          charge.cancel(this.clock.now());
          await this.charges.save(charge);
        }
      }
      return ids.length;
    });
  }
}
