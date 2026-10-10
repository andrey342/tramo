import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { VerifyCenterVatCommand } from '../../application/commands/verify-center-vat.command';
import { CatalogEvents, type CenterRegisteredPayload } from '../../domain';

export class VatRegistryUnavailableError extends Error {
  constructor(centerId: string) {
    super(`VIES could not check the VAT number of center ${centerId}; retrying later.`);
    this.name = 'VatRegistryUnavailableError';
  }
}

// Checks a new center's VAT number once its registration is committed. When VIES cannot answer,
// the job fails so BullMQ retries it with backoff; the claim and the "unverified" mark roll back
// with it, and after the last attempt the event lands in the dead-letter queue, where ops can
// see it (or ask again from POST /centers/:id/verify-vat).
@Injectable()
@EventSubscriber({ event: CatalogEvents.CenterRegistered, consumer: 'catalog.verify-center-vat' })
export class VerifyRegisteredCenterVatConsumer implements EventHandler<CenterRegisteredPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<CenterRegisteredPayload>): Promise<void> {
    const center = await this.commands.execute(
      new VerifyCenterVatCommand('system', event.payload.centerId),
    );
    if (center.vatValidation?.status === 'unverified') {
      throw new VatRegistryUnavailableError(event.payload.centerId);
    }
  }
}
