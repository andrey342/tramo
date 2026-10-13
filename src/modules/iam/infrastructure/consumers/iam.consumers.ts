import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import {
  CatalogEvents,
  type CenterSuspendedPayload,
} from '@modules/catalog/domain/events/catalog-events';
import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { RevokeCenterApiKeysCommand } from '../../application/commands/revoke-center-api-keys.command';

// A suspended center loses its API keys. Its users keep signing in: they still follow their
// contracts and payouts, and the catalog already refuses what a suspended center may not change.
@Injectable()
@EventSubscriber({
  event: CatalogEvents.CenterSuspended,
  consumer: 'iam.revoke-suspended-center-keys',
})
export class RevokeKeysOnCenterSuspended implements EventHandler<CenterSuspendedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<CenterSuspendedPayload>): Promise<void> {
    await this.commands.execute(new RevokeCenterApiKeysCommand(event.payload.centerId));
  }
}
