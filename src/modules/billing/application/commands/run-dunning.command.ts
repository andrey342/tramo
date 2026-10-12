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

export interface DunningResult {
  readonly chargesReviewed: number;
  readonly retries: number;
}

// The daily dunning run, as of a day: every charge not settled moves through the steps of the
// timeline it has reached (Charge.applyDunning), and the retries it calls for are submitted when
// the contract has a mandate. Each charge in its own transaction; steps already applied are not
// applied again, so the run can repeat.
export class RunDunningCommand extends Command<DunningResult> {
  constructor(readonly asOf: CalendarDate) {
    super();
  }
}

@CommandHandler(RunDunningCommand)
export class RunDunningHandler implements ICommandHandler<RunDunningCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RunDunningCommand): Promise<DunningResult> {
    let chargesReviewed = 0;
    let retries = 0;
    let after: string | null = null;
    for (;;) {
      const ids = await this.charges.findUnsettledIds(PAGE, after);
      for (const id of ids) {
        chargesReviewed += 1;
        retries += (await this.dun(id, command.asOf)) ? 1 : 0;
      }
      if (ids.length < PAGE) {
        return { chargesReviewed, retries };
      }
      after = ids.at(-1) ?? null;
    }
  }

  private dun(chargeId: string, asOf: CalendarDate): Promise<boolean> {
    return this.uow.run(async () => {
      const charge = await this.charges.findById(chargeId);
      if (!charge) {
        return false;
      }
      const now = this.clock.now();
      const step = charge.dunningStep;
      const { retry } = charge.applyDunning(asOf, now);
      const mandate = retry ? await this.mandates.findActiveByContract(charge.contractId) : null;
      if (mandate) {
        charge.submitCollection(mandate.id, now);
      }
      if (charge.dunningStep !== step || charge.hasPendingEvents) {
        await this.charges.save(charge);
      }
      return mandate !== null;
    });
  }
}
