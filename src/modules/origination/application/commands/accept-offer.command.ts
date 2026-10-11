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

export class AcceptOfferCommand extends Command<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
  ) {
    super();
  }
}

// The student takes the approved financing; OfferAccepted hands it to lending for the contract.
@CommandHandler(AcceptOfferCommand)
export class AcceptOfferHandler implements ICommandHandler<AcceptOfferCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: AcceptOfferCommand): Promise<ApplicationDto> {
    return this.uow.run(async () => {
      const application = await findVisibleApplication(
        this.applications,
        command.actor,
        command.applicationId,
      );
      if (!actsForApplicant(command.actor, application)) {
        throw new ApplicationAccessDeniedError();
      }
      application.acceptOffer(this.clock.now());
      await this.applications.save(application);
      return toApplicationDto(application, { withProfile: true });
    });
  }
}
