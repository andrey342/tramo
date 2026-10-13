import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type IntegrationEvent, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';

import { ReportingProjector } from '../reporting-projector';

// One event, as it happens, applied to the read models.
export class ProjectEventCommand extends Command<void> {
  constructor(readonly event: IntegrationEvent) {
    super();
  }
}

@CommandHandler(ProjectEventCommand)
export class ProjectEventHandler implements ICommandHandler<ProjectEventCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    private readonly projector: ReportingProjector,
  ) {}

  async execute(command: ProjectEventCommand): Promise<void> {
    await this.uow.run(() => this.projector.apply(command.event));
  }
}
