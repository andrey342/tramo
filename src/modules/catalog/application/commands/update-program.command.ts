import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  PROGRAM_REPOSITORY,
  type ProgramRepository,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';
import { canManagePrograms } from '../center-access';
import { type ProgramDto } from '../dto/program.dto';
import {
  type FinancingInput,
  type ProgramDetailsInput,
  toFinancingOptions,
  toProgramDetailChanges,
} from '../program-input';
import { toProgramDto } from '../program.mapping';

export interface ProgramChanges {
  readonly details?: Partial<ProgramDetailsInput>;
  readonly financing?: FinancingInput;
  readonly status?: 'published' | 'archived';
}

export class UpdateProgramCommand extends Command<ProgramDto> {
  constructor(
    readonly actor: Principal,
    readonly programId: string,
    readonly changes: ProgramChanges,
  ) {
    super();
  }
}

// Details and options first, then the status change, so "change the price and publish" in one
// request publishes the new price.
@CommandHandler(UpdateProgramCommand)
export class UpdateProgramHandler implements ICommandHandler<UpdateProgramCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PROGRAM_REPOSITORY) private readonly programs: ProgramRepository,
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: UpdateProgramCommand): Promise<ProgramDto> {
    const { changes } = command;
    return this.uow.run(async () => {
      const program = await this.programs.findById(command.programId);
      // Programs of other centers are reported as missing, not forbidden.
      if (!program || !canManagePrograms(command.actor, program.centerId)) {
        throw new EntityNotFoundError('Program', command.programId);
      }
      const now = this.clock.now();
      if (changes.details) program.updateDetails(toProgramDetailChanges(changes.details), now);
      if (changes.financing) program.changeFinancing(toFinancingOptions(changes.financing), now);
      if (changes.status === 'published') {
        const center = await this.centers.findById(program.centerId);
        program.publish({ isActive: center?.isActive ?? false }, now);
      }
      if (changes.status === 'archived') program.archive(now);
      await this.programs.save(program);
      return toProgramDto(program);
    });
  }
}
