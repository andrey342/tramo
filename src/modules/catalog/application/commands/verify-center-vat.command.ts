import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  type TrainingCenter,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';
import { type Actor, assertCanOperate } from '../center-access';
import { type TrainingCenterDto } from '../dto/training-center.dto';
import { VAT_VALIDATOR, type VatValidator } from '../ports/catalog-ports';
import { toTrainingCenterDto } from '../training-center.mapping';

export class VerifyCenterVatCommand extends Command<TrainingCenterDto> {
  constructor(
    readonly actor: Actor,
    readonly centerId: string,
  ) {
    super();
  }
}

@CommandHandler(VerifyCenterVatCommand)
export class VerifyCenterVatHandler implements ICommandHandler<VerifyCenterVatCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(TRAINING_CENTER_REPOSITORY) private readonly centers: TrainingCenterRepository,
    @Inject(VAT_VALIDATOR) private readonly vat: VatValidator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: VerifyCenterVatCommand): Promise<TrainingCenterDto> {
    assertCanOperate(command.actor, command.centerId);
    const before = await this.load(command.centerId);
    // The registry is asked outside the write transaction; the center is loaded again to apply
    // the answer, so a change made meanwhile is not overwritten.
    const result = await this.vat.check(before.vatNumber);
    return this.uow.run(async () => {
      const center = await this.load(command.centerId);
      center.recordVatCheck(result, this.clock.now());
      await this.centers.save(center);
      return toTrainingCenterDto(center);
    });
  }

  private async load(centerId: string): Promise<TrainingCenter> {
    const center = await this.centers.findById(centerId);
    if (!center) {
      throw new EntityNotFoundError('TrainingCenter', centerId);
    }
    return center;
  }
}
