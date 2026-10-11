import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';

// Marks a submitted application as being verified, when the saga queues its checks. A check that
// answered first already moved it, and a repeated event finds it moved: both are fine.
export class StartVerificationCommand extends Command<void> {
  constructor(readonly applicationId: string) {
    super();
  }
}

@CommandHandler(StartVerificationCommand)
export class StartVerificationHandler implements ICommandHandler<StartVerificationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: StartVerificationCommand): Promise<void> {
    await this.uow.run(async () => {
      const application = await this.applications.findById(command.applicationId);
      if (application?.status !== 'submitted') {
        return;
      }
      application.startVerification(this.clock.now());
      await this.applications.save(application);
    });
  }
}
