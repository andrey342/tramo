import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  CHARGE_REPOSITORY,
  type ChargeRepository,
  PAYMENT_MANDATE_REPOSITORY,
  type PaymentMandateRepository,
} from '../../domain';

// Lending cancelled the contract before it took effect (declined, never signed, or the center was
// never paid): nothing will be collected, so a mandate the student signed for it is revoked rather
// than left in force. Idempotent: a contract without an active mandate is left as it is.
export class RevokeContractMandateCommand extends Command<boolean> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(RevokeContractMandateCommand)
export class RevokeContractMandateHandler implements ICommandHandler<RevokeContractMandateCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_MANDATE_REPOSITORY) private readonly mandates: PaymentMandateRepository,
    @Inject(CHARGE_REPOSITORY) private readonly charges: ChargeRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(command: RevokeContractMandateCommand): Promise<boolean> {
    return this.uow.run(async () => {
      // Under the contract's lock, like every path that reads or swaps the mandate in force.
      await this.charges.lockContract(command.contractId);
      const mandate = await this.mandates.findActiveByContract(command.contractId);
      if (!mandate) {
        return false;
      }
      mandate.revoke(this.clock.now());
      await this.mandates.save(mandate);
      return true;
    });
  }
}
