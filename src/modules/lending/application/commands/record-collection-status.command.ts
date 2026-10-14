import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { type CalendarDate, CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { CONTRACT_REPOSITORY, type ContractRepository } from '../../domain';

// What billing's dunning says about a contract: a charge 30 days overdue (ContractInArrears),
// nothing in arrears after a payment (ArrearsCleared), or a charge written off after 90 days
// (ChargeWrittenOff), which defaults the contract.
export type CollectionStatus = 'in_arrears' | 'current' | 'defaulted';

export class RecordCollectionStatusCommand extends Command<void> {
  constructor(
    readonly contractId: string,
    readonly status: CollectionStatus,
    // When billing noticed it: the order of the notices, whatever the order they arrive in.
    readonly noticedAt: Date,
    // The day of a write-off, which may differ from today in a catch-up run.
    readonly day: CalendarDate | null = null,
  ) {
    super();
  }
}

@CommandHandler(RecordCollectionStatusCommand)
export class RecordCollectionStatusHandler implements ICommandHandler<RecordCollectionStatusCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RecordCollectionStatusCommand): Promise<void> {
    await this.uow.run(async () => {
      const contract = await this.contracts.findById(command.contractId);
      if (!contract) {
        throw new EntityNotFoundError('Contract', command.contractId);
      }
      const before = contract.status;
      const now = this.clock.now();
      switch (command.status) {
        case 'in_arrears':
          contract.markInArrears(command.noticedAt, now);
          break;
        case 'current':
          contract.clearArrears(command.noticedAt, now);
          break;
        case 'defaulted':
          contract.declareDefault(now, command.day);
          break;
      }
      // Transitions are idempotent: a redelivery finds the status already set.
      if (contract.status !== before) {
        await this.contracts.save(contract);
      }
    });
  }
}
