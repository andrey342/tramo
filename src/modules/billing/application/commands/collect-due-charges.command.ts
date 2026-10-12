import { Inject, Logger } from '@nestjs/common';
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

export interface CollectionRunResult {
  readonly submitted: number;
  // Charges whose submission failed (and was rolled back); the next run tries them again.
  readonly failedChargeIds: readonly string[];
}

// Starts the collection of every scheduled charge due by `asOf` (of one contract, when given). A
// charge without a mandate is left scheduled: dunning reminds the student and chases it. While a
// payoff of the contract is being collected, its other charges wait (cancelled once it is paid).
export class CollectDueChargesCommand extends Command<CollectionRunResult> {
  constructor(
    readonly asOf: CalendarDate,
    readonly contractId: string | null = null,
  ) {
    super();
  }
}

@CommandHandler(CollectDueChargesCommand)
export class CollectDueChargesHandler implements ICommandHandler<CollectDueChargesCommand> {
  private readonly logger = new Logger(CollectDueChargesHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CollectDueChargesCommand): Promise<CollectionRunResult> {
    let submitted = 0;
    const failedChargeIds: string[] = [];
    let after: string | null = null;
    for (;;) {
      const ids = await this.charges.findDueIds(command.asOf, PAGE, after, command.contractId);
      for (const id of ids) {
        try {
          submitted += (await this.submit(id)) ? 1 : 0;
        } catch (error) {
          failedChargeIds.push(id);
          this.logger.error({ chargeId: id, err: error }, 'Charge not submitted for collection');
        }
      }
      if (ids.length < PAGE) {
        return { submitted, failedChargeIds };
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
      if (charge.kind !== 'payoff' && (await this.charges.hasPayoff(charge.contractId))) {
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
