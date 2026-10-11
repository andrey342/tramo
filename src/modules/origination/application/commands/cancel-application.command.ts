import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  ApplicationAccessDeniedError,
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
} from '../../domain';
import { actsForApplicant, findVisibleApplication } from '../application-access';
import { toApplicationDto } from '../application.mapping';
import { type ApplicationDto } from '../dto/application.dto';

export class CancelApplicationCommand extends Command<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
  ) {
    super();
  }
}

// Only the student withdraws an application, at any point before it is final.
@CommandHandler(CancelApplicationCommand)
export class CancelApplicationHandler implements ICommandHandler<CancelApplicationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CancelApplicationCommand): Promise<ApplicationDto> {
    return this.uow.run(async () => {
      const application = await findVisibleApplication(
        this.applications,
        command.actor,
        command.applicationId,
      );
      if (!actsForApplicant(command.actor, application)) {
        throw new ApplicationAccessDeniedError();
      }
      application.cancel(this.clock.now());
      await this.applications.save(application);
      return toApplicationDto(application, { withProfile: true });
    });
  }
}
