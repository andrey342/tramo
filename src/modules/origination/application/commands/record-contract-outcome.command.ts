import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';

// What became of the contract lending drew up from an accepted offer: cancelled before it took
// effect (ContractCancelled) or run its course (ContractCompleted). Either frees the program for
// another application by the same student.
export type ContractOutcome = 'cancelled' | 'completed';

export class RecordContractOutcomeCommand extends Command<void> {
  constructor(
    readonly applicationId: string,
    readonly outcome: ContractOutcome,
  ) {
    super();
  }
}

@CommandHandler(RecordContractOutcomeCommand)
export class RecordContractOutcomeHandler implements ICommandHandler<RecordContractOutcomeCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RecordContractOutcomeCommand): Promise<void> {
    await this.uow.run(async () => {
      const application = await this.applications.findById(command.applicationId);
      if (!application) {
        throw new EntityNotFoundError('FinancingApplication', command.applicationId);
      }
      const before = application.status;
      const now = this.clock.now();
      if (command.outcome === 'cancelled') {
        application.withdraw(now);
      } else {
        application.close(now);
      }
      // Transitions are idempotent: a redelivery finds the status already set.
      if (application.status !== before) {
        await this.applications.save(application);
      }
    });
  }
}
