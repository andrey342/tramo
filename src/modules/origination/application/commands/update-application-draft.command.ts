import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  ApplicationAccessDeniedError,
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
  type ProgramSnapshot,
  ProgramNotAvailableError,
} from '../../domain';
import { canEditDraft, canSeePersonalData, findVisibleApplication } from '../application-access';
import { type ProfileInput, toProfileChanges } from '../application-input';
import { toApplicationDto } from '../application.mapping';
import { type ApplicationDto, type RequestedProductDto } from '../dto/application.dto';
import { PROGRAM_DIRECTORY, type ProgramDirectory } from '../ports/origination-ports';

export interface DraftChanges {
  readonly programId?: string;
  readonly product?: RequestedProductDto;
  readonly profile?: ProfileInput;
}

export class UpdateApplicationDraftCommand extends Command<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly applicationId: string,
    readonly changes: DraftChanges,
  ) {
    super();
  }
}

@CommandHandler(UpdateApplicationDraftCommand)
export class UpdateApplicationDraftHandler implements ICommandHandler<UpdateApplicationDraftCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(PROGRAM_DIRECTORY) private readonly programs: ProgramDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: UpdateApplicationDraftCommand): Promise<ApplicationDto> {
    const { actor, changes } = command;
    return this.uow.run(async () => {
      const application = await findVisibleApplication(
        this.applications,
        actor,
        command.applicationId,
      );
      if (!canEditDraft(actor, application)) {
        throw new ApplicationAccessDeniedError();
      }
      let program: ProgramSnapshot | undefined;
      if (changes.programId !== undefined && changes.programId !== application.program.programId) {
        const found = await this.programs.findOpenProgram(changes.programId);
        // A center moves its students between its own programs only.
        if (!found || (actor.kind === 'api_key' && found.centerId !== actor.centerId)) {
          throw new ProgramNotAvailableError(changes.programId);
        }
        program = found;
      }
      application.updateDraft(
        {
          program,
          product: changes.product,
          profile: changes.profile ? toProfileChanges(changes.profile) : undefined,
        },
        this.clock.now(),
      );
      await this.applications.save(application);
      return toApplicationDto(application, {
        withProfile: canSeePersonalData(actor, application),
      });
    });
  }
}
