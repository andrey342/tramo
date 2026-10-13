import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  ContractNotRepayingError,
  MandateMissingError,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
  PayoffInProgressError,
} from '../../domain';
import { assertStaff } from '../billing-access';
import { toChargeDto } from '../billing.mapping';
import { type ChargeDto } from '../dto/billing.dto';
import { REPAYMENT_PLANS, type RepaymentPlans } from '../ports/billing-ports';

// Ops collect a failed or overdue charge again, outside the dunning timeline (the student asked,
// or fixed their account), or ask the provider again for a charge stuck in collection. Also
// the last charge of a plan that ended with it (an ISA at its cap); not once the contract
// defaulted, its debt gone to recovery.
export class RetryChargeCommand extends Command<ChargeDto> {
  constructor(
    readonly actor: Principal,
    readonly chargeId: string,
  ) {
    super();
  }
}

@CommandHandler(RetryChargeCommand)
export class RetryChargeHandler implements ICommandHandler<RetryChargeCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(REPAYMENT_PLANS) private readonly plans: RepaymentPlans,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RetryChargeCommand): Promise<ChargeDto> {
    assertStaff(command.actor);
    return this.uow.run(async () => {
      const found = await this.charges.findById(command.chargeId);
      if (!found) {
        throw new EntityNotFoundError('Charge', command.chargeId);
      }
      await this.charges.lockContract(found.contractId);
      const charge = (await this.charges.findById(command.chargeId)) ?? found;
      // A new attempt would debit again what a payoff covers; asking again about one in
      // collection (same key) debits nothing new.
      if (
        charge.status !== 'pending' &&
        charge.kind !== 'payoff' &&
        (await this.charges.hasPayoff(charge.contractId))
      ) {
        throw new PayoffInProgressError(charge.contractId);
      }
      const contract = await this.plans.findContract(charge.contractId);
      if (!contract || contract.status === 'defaulted') {
        throw new ContractNotRepayingError(contract?.status ?? 'unknown');
      }
      const mandate = await this.mandates.findActiveByContract(charge.contractId);
      if (!mandate) {
        throw new MandateMissingError(charge.contractId);
      }
      charge.retryCollection(mandate.id, this.clock.now());
      await this.charges.save(charge);
      return toChargeDto(charge);
    });
  }
}
