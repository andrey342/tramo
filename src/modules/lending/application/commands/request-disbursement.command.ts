import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import {
  CLOCK,
  type Clock,
  EntityNotFoundError,
  InvalidStateTransitionError,
} from '@shared/domain';

import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
  Disbursement,
  DISBURSEMENT_REPOSITORY,
  disbursementAmount,
  type DisbursementRepository,
} from '../../domain';

// A signed contract pays the center. One disbursement per contract: a redelivered ContractSigned
// finds it and changes nothing.
export class RequestDisbursementCommand extends Command<void> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(RequestDisbursementCommand)
export class RequestDisbursementHandler implements ICommandHandler<RequestDisbursementCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(DISBURSEMENT_REPOSITORY) private readonly disbursements: DisbursementRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RequestDisbursementCommand): Promise<void> {
    await this.uow.run(async () => {
      if (await this.disbursements.findByContractId(command.contractId)) {
        return;
      }
      const contract = await this.contracts.findById(command.contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', command.contractId);
      }
      if (contract.status !== 'signed') {
        throw new InvalidStateTransitionError('Contract', contract.status, 'disbursement');
      }
      await this.disbursements.save(
        Disbursement.request({
          id: uuidv7(),
          contractId: contract.id,
          centerId: contract.centerId,
          amount: disbursementAmount(contract.terms),
          now: this.clock.now(),
        }),
      );
    });
  }
}
