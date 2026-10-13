import { Inject, Injectable, type Type } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { ProjectEventCommand } from '../../application/commands/project-event.command';
import { ReportingProjector } from '../../application/reporting-projector';

// One consumer per event the read models follow (ReportingProjector.EVENTS), all the same: apply
// the event. Each is exactly once by its claim in processed_events; the projection itself can be
// applied twice anyway (upserts), which is what the rebuild relies on.
function projectionConsumer(eventType: string): Type<EventHandler> {
  const consumer = `reporting.project-${eventType.replace(/[A-Z]/g, (letter, index: number) => `${index === 0 ? '' : '-'}${letter.toLowerCase()}`)}`;

  @Injectable()
  @EventSubscriber({ event: eventType, consumer })
  class ProjectionConsumer implements EventHandler {
    constructor(@Inject(CommandBus) private readonly commands: CommandBus) {}

    async handle(event: IntegrationEvent): Promise<void> {
      await this.commands.execute(new ProjectEventCommand(event));
    }
  }

  Object.defineProperty(ProjectionConsumer, 'name', { value: `Project${eventType}` });
  return ProjectionConsumer;
}

export const REPORTING_CONSUMERS: readonly Type<EventHandler>[] =
  ReportingProjector.EVENTS.map(projectionConsumer);
