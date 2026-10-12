import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  MandateMissingError,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
} from '../../domain';
import { assertStaff } from '../billing-access';
import { toChargeDto } from '../billing.mapping';
import { type ChargeDto } from '../dto/billing.dto';

// Ops collect a failed or overdue charge again, outside the dunning timeline (the student asked,
// or fixed their account).
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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RetryChargeCommand): Promise<ChargeDto> {
    assertStaff(command.actor);
    return this.uow.run(async () => {
      const charge = await this.charges.findById(command.chargeId);
      if (!charge) {
        throw new EntityNotFoundError('Charge', command.chargeId);
      }
      const mandate = await this.mandates.findActiveByContract(charge.contractId);
      if (!mandate) {
        throw new MandateMissingError(charge.contractId);
      }
      charge.submitCollection(mandate.id, this.clock.now());
      await this.charges.save(charge);
      return toChargeDto(charge);
    });
  }
}
