import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  ApplicationAccessDeniedError,
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
  ProgramNotAvailableError,
} from '../../domain';
import { actsForApplicant, findVisibleApplication } from '../application-access';
import { toApplicationDto } from '../application.mapping';
import { type ApplicationDto } from '../dto/application.dto';
import { PROGRAM_DIRECTORY, type ProgramDirectory } from '../ports/origination-ports';

export class SubmitApplicationCommand extends Command<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
  ) {
    super();
  }
}

// The student applies for the program as the catalog offers it now: a price or an option changed
// since the draft was started is what they submit.
@CommandHandler(SubmitApplicationCommand)
export class SubmitApplicationHandler implements ICommandHandler<SubmitApplicationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(PROGRAM_DIRECTORY) private readonly programs: ProgramDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: SubmitApplicationCommand): Promise<ApplicationDto> {
    return this.uow.run(async () => {
      const application = await findVisibleApplication(
        this.applications,
        command.actor,
        command.applicationId,
      );
      if (!actsForApplicant(command.actor, application)) {
        throw new ApplicationAccessDeniedError();
      }
      const program = await this.programs.findOpenProgram(application.program.programId);
      if (!program) {
        throw new ProgramNotAvailableError(application.program.programId);
      }
      application.submit(program, this.clock.now());
      await this.applications.save(application);
      return toApplicationDto(application, { withProfile: true });
    });
  }
}
