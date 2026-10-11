import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  ApplicationAccessDeniedError,
  type ApplicationOrigin,
  EMPTY_PROFILE,
  FINANCING_APPLICATION_REPOSITORY,
  FinancingApplication,
  type FinancingApplicationRepository,
  ProgramNotAvailableError,
  StudentNotFoundError,
} from '../../domain';
import { type ProfileInput, toProfileChanges } from '../application-input';
import { toApplicationDto } from '../application.mapping';
import { type ApplicationDto, type RequestedProductDto } from '../dto/application.dto';
import {
  PROGRAM_DIRECTORY,
  type ProgramDirectory,
  STUDENT_DIRECTORY,
  type StudentDirectory,
} from '../ports/origination-ports';

export interface StartApplicationInput {
  readonly programId: string;
  readonly product: RequestedProductDto;
  readonly profile: ProfileInput;
  // Required when a training center starts the application for one of its students.
  readonly studentEmail?: string;
}

export class StartApplicationCommand extends Command<ApplicationDto> {
  constructor(
    readonly actor: Principal,
    readonly input: StartApplicationInput,
  ) {
    super();
  }
}

// A student applies for themselves; a training center's integration (API key with
// applications:write) applies for a student of one of its own programs, who must already have an
// account. Either way the application starts as a draft.
@CommandHandler(StartApplicationCommand)
export class StartApplicationHandler implements ICommandHandler<StartApplicationCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(FINANCING_APPLICATION_REPOSITORY)
    private readonly applications: FinancingApplicationRepository,
    @Inject(PROGRAM_DIRECTORY) private readonly programs: ProgramDirectory,
    @Inject(STUDENT_DIRECTORY) private readonly students: StudentDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: StartApplicationCommand): Promise<ApplicationDto> {
    const { actor, input } = command;
    const program = await this.programs.findOpenProgram(input.programId);
    if (!program) {
      throw new ProgramNotAvailableError(input.programId);
    }
    const applicant = await this.applicantFor(actor, program.centerId, input.studentEmail);
    const profile = { ...EMPTY_PROFILE, ...toProfileChanges(input.profile) };

    return this.uow.run(async () => {
      const application = FinancingApplication.start({
        id: uuidv7(),
        applicantId: applicant.id,
        origin: applicant.origin,
        program,
        product: input.product,
        profile,
        now: this.clock.now(),
      });
      await this.applications.save(application);
      return toApplicationDto(application, { withProfile: applicant.origin === 'student' });
    });
  }

  private async applicantFor(
    actor: Principal,
    centerId: string,
    studentEmail: string | undefined,
  ): Promise<{ id: string; origin: ApplicationOrigin }> {
    if (actor.kind === 'user' && actor.roles.includes('student')) {
      return { id: actor.userId, origin: 'student' };
    }
    if (
      actor.kind === 'api_key' &&
      actor.scopes.includes('applications:write') &&
      actor.centerId === centerId
    ) {
      const studentId = studentEmail ? await this.students.findStudentId(studentEmail) : null;
      if (!studentId) {
        throw new StudentNotFoundError();
      }
      return { id: studentId, origin: 'center' };
    }
    throw new ApplicationAccessDeniedError();
  }
}
