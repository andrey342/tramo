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
import { REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

const PAGE = 200;

export interface DunningResult {
  readonly chargesReviewed: number;
  readonly retries: number;
  // Charges whose dunning failed (and was rolled back); the next run applies their steps.
  readonly failedChargeIds: readonly string[];
}

// The daily dunning run, as of a day (for one contract, when given): every charge not settled
// moves through the steps of the timeline it has reached (Charge.applyDunning), and the retries
// it calls for are submitted when the contract has a mandate and has not defaulted: after the
// default the debt goes to recovery, and its charges only go on to their notices and write-off.
// A contract paying off is not dunned: the payoff covers its charges. Each charge in its own transaction, under the
// contract's lock; steps already applied are not applied again, so the run can repeat.
export class RunDunningCommand extends Command<DunningResult> {
  constructor(
    readonly asOf: CalendarDate,
    readonly contractId: string | null = null,
  ) {
    super();
  }
}

@CommandHandler(RunDunningCommand)
export class RunDunningHandler implements ICommandHandler<RunDunningCommand> {
  private readonly logger = new Logger(RunDunningHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RunDunningCommand): Promise<DunningResult> {
    let chargesReviewed = 0;
    let retries = 0;
    const failedChargeIds: string[] = [];
    let after: string | null = null;
    for (;;) {
      const ids = await this.charges.findUnsettledIds(PAGE, after, command.contractId);
      for (const id of ids) {
        chargesReviewed += 1;
        try {
          retries += (await this.dun(id, command.asOf)) ? 1 : 0;
        } catch (error) {
          failedChargeIds.push(id);
          this.logger.error({ chargeId: id, err: error }, 'Dunning failed for a charge');
        }
      }
      if (ids.length < PAGE) {
        return { chargesReviewed, retries, failedChargeIds };
      }
      after = ids.at(-1) ?? null;
    }
  }

  private dun(chargeId: string, asOf: CalendarDate): Promise<boolean> {
    return this.uow.run(async () => {
      const found = await this.charges.findById(chargeId);
      if (!found) {
        return false;
      }
      // Arrears are decided under the contract's lock, then on the charge as it is now.
      await this.charges.lockContract(found.contractId);
      const charge = (await this.charges.findById(chargeId)) ?? found;
      if (charge.kind !== 'payoff' && (await this.charges.hasPayoff(charge.contractId))) {
        return false;
      }
      const now = this.clock.now();
      const step = charge.dunningStep;
      // The contract is announced in arrears once: not again by its next charge, nor once it has
      // ended (defaulted, or completed with a payment returned since, ADR 020).
      const contractInArrears =
        charge.reachesArrears(asOf) &&
        ((await this.charges.hasOtherChargesInArrears(charge.contractId, charge.id)) ||
          (await this.defaulted(charge.contractId, asOf)) ||
          (await this.plans.findContract(charge.contractId))?.status === 'completed');
      const { retry } = charge.applyDunning(asOf, now, contractInArrears);
      const mandate =
        retry && !(await this.defaulted(charge.contractId, asOf))
          ? await this.mandates.findActiveByContract(charge.contractId)
          : null;
      if (mandate) {
        charge.submitCollection(mandate.id, now);
      }
      if (charge.dunningStep !== step || charge.hasPendingEvents) {
        await this.charges.save(charge);
      }
      return mandate !== null;
    });
  }

  // Asked only when a retry or the arrears step is due, which is a few times in a charge's life.
  // Billing knows of a default first (a charge written off, or reaching it in this very run);
  // lending's status covers the rest.
  private async defaulted(contractId: string, asOf: CalendarDate): Promise<boolean> {
    return (
      (await this.charges.defaultsBy(contractId, asOf)) ||
      (await this.plans.findContract(contractId))?.status === 'defaulted'
    );
  }
}
