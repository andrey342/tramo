import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  Program,
  type ProgramDetails,
  PROGRAM_REPOSITORY,
  type ProgramRepository,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';
import { assertCanManagePrograms } from '../center-access';
import { type ProgramDto } from '../dto/program.dto';
import {
  type FinancingInput,
  type ProgramDetailsInput,
  toFinancingOptions,
  toProgramDetails,
} from '../program-input';
import { toProgramDto } from '../program.mapping';

export class CreateProgramCommand extends Command<ProgramDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly details: ProgramDetailsInput,
    readonly financing: FinancingInput,
  ) {
    super();
  }
}

// New programs are drafts; publishing is a separate step (UpdateProgram) once the center is
// active and the financing options are settled.
@CommandHandler(CreateProgramCommand)
export class CreateProgramHandler implements ICommandHandler<CreateProgramCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CreateProgramCommand): Promise<ProgramDto> {
    assertCanManagePrograms(command.actor, command.centerId);
    const details = toProgramDetails(command.details) as ProgramDetails;
    const financing = toFinancingOptions(command.financing);

    return this.uow.run(async () => {
      if (!(await this.centers.findById(command.centerId))) {
        throw new EntityNotFoundError('TrainingCenter', command.centerId);
      }
      const program = Program.create({
        id: uuidv7(),
        centerId: command.centerId,
        details,
        financing,
        now: this.clock.now(),
      });
      await this.programs.save(program);
      return toProgramDto(program);
    });
  }
}
