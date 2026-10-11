import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';

// Run by the expiry sweep for each stale application. The staleness is checked again here: the
// application may have moved since the sweep listed it.
export class ExpireApplicationCommand extends Command<boolean> {
  constructor(readonly applicationId: string) {
    super();
  }
}

@CommandHandler(ExpireApplicationCommand)
export class ExpireApplicationHandler implements ICommandHandler<ExpireApplicationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  // Whether it expired.
  async execute(command: ExpireApplicationCommand): Promise<boolean> {
    return this.uow.run(async () => {
      const application = await this.applications.findById(command.applicationId);
      const now = this.clock.now();
      if (!application?.isStale(now)) {
        return false;
      }
      application.expire(now);
      await this.applications.save(application);
      return true;
    });
  }
}
