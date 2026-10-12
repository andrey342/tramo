import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { CHARGE_REPOSITORY, type ChargeRepository } from '../../domain';

// A plan was paid off: what the payoff covered is no longer owed, whether scheduled or failed
// and in dunning (`all`). A contract defaulted: the charges not yet due are cancelled
// (`scheduled`), those overdue stay as the debt. Those being collected are left to the
// provider's answer.
export class CancelOpenChargesCommand extends Command<number> {
  constructor(
    readonly contractId: string,
    readonly scope: 'all' | 'scheduled',
  ) {
    super();
  }
}

@CommandHandler(CancelOpenChargesCommand)
export class CancelOpenChargesHandler implements ICommandHandler<CancelOpenChargesCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CancelOpenChargesCommand): Promise<number> {
    return this.uow.run(async () => {
      await this.charges.lockContract(command.contractId);
      let cancelled = 0;
      for (const id of await this.charges.findOpenIds(command.contractId)) {
        const charge = await this.charges.findById(id);
        if (!charge || (command.scope === 'scheduled' && charge.status !== 'scheduled')) {
          continue;
        }
        charge.cancel(this.clock.now());
        await this.charges.save(charge);
        cancelled += 1;
      }
      return cancelled;
    });
  }
}
