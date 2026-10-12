import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { CONTRACT_REPOSITORY, type ContractRepository } from '../../domain';

// The center has been paid: the contract takes effect. Run after DisbursementSettled; a
// redelivery finds it active and changes nothing.
export class ActivateContractCommand extends Command<void> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(ActivateContractCommand)
export class ActivateContractHandler implements ICommandHandler<ActivateContractCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ActivateContractCommand): Promise<void> {
    await this.uow.run(async () => {
      const contract = await this.contracts.findById(command.contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', command.contractId);
      }
      if (contract.status !== 'signed') {
        return;
      }
      contract.activate(this.clock.now());
      await this.contracts.save(contract);
    });
  }
}
