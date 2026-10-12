import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  ContractAccessDeniedError,
  DISBURSEMENT_REPOSITORY,
  type DisbursementRepository,
} from '../../domain';
import { isStaff } from '../contract-access';
import { toDisbursementDto } from '../contract.mapping';
import { type DisbursementDto } from '../dto/contract.dto';

// Ops send a failed disbursement again, once the cause is fixed (the center corrected its IBAN,
// or was reactivated). DisbursementRetried queues the new transfer.
export class RetryDisbursementCommand extends Command<DisbursementDto> {
  constructor(
    readonly actor: Principal,
    readonly disbursementId: string,
  ) {
    super();
  }
}

@CommandHandler(RetryDisbursementCommand)
export class RetryDisbursementHandler implements ICommandHandler<RetryDisbursementCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RetryDisbursementCommand): Promise<DisbursementDto> {
    if (!isStaff(command.actor)) {
      throw new ContractAccessDeniedError();
    }
    return this.uow.run(async () => {
      const disbursement = await this.disbursements.findById(command.disbursementId);
      if (!disbursement) {
        throw new EntityNotFoundError('Disbursement', command.disbursementId);
      }
      disbursement.retry(this.clock.now());
      await this.disbursements.save(disbursement);
      return toDisbursementDto(disbursement);
    });
  }
}
