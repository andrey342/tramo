import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { CONTRACT_REPOSITORY, type ContractRepository } from '../../domain';

// The plan has ended, so does the contract. Run after PlanCompleted; a redelivery finds it
// completed and changes nothing.
export class CompleteContractCommand extends Command<void> {
  constructor(readonly contractId: string) {
    super();
  }
}

@CommandHandler(CompleteContractCommand)
export class CompleteContractHandler implements ICommandHandler<CompleteContractCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CompleteContractCommand): Promise<void> {
    await this.uow.run(async () => {
      const contract = await this.contracts.findById(command.contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', command.contractId);
      }
      if (contract.status !== 'active') {
        return;
      }
      contract.complete(this.clock.now());
      await this.contracts.save(contract);
    });
  }
}
