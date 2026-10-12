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

const PAGE = 200;

// Starts the collection of every scheduled charge due by `asOf`. A charge without a mandate is
// left scheduled: dunning reminds the student and chases it.
export class CollectDueChargesCommand extends Command<number> {
  constructor(readonly asOf: CalendarDate) {
    super();
  }
}

@CommandHandler(CollectDueChargesCommand)
export class CollectDueChargesHandler implements ICommandHandler<CollectDueChargesCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CollectDueChargesCommand): Promise<number> {
    let submitted = 0;
    let after: string | null = null;
    for (;;) {
      const ids = await this.charges.findDueIds(command.asOf, PAGE, after);
      for (const id of ids) {
        submitted += (await this.submit(id)) ? 1 : 0;
      }
      if (ids.length < PAGE) {
        return submitted;
      }
      after = ids.at(-1) ?? null;
    }
  }

  private submit(chargeId: string): Promise<boolean> {
    return this.uow.run(async () => {
      const charge = await this.charges.findById(chargeId);
      if (charge?.status !== 'scheduled') {
        return false;
      }
      const mandate = await this.mandates.findActiveByContract(charge.contractId);
      if (!mandate) {
        return false;
      }
      charge.submitCollection(mandate.id, this.clock.now());
      await this.charges.save(charge);
      return true;
    });
  }
}
