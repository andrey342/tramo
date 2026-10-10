import { Injectable } from '@nestjs/common';

import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { CatalogEvents, type CenterRegisteredPayload } from '../../domain';
import { VatCheckScheduler } from '../jobs/vat-checks';

// Only queues the check of a new center's VAT number. Asking VIES here would keep the event's
// transaction (and its connection) open for as long as VIES takes, and tie the check to the
// events queue's short retry schedule; the vat-checks queue has its own (VatCheckProcessor).
@Injectable()
@EventSubscriber({ event: CatalogEvents.CenterRegistered, consumer: 'catalog.verify-center-vat' })
export class VerifyRegisteredCenterVatConsumer implements EventHandler<CenterRegisteredPayload> {
  constructor(private readonly vatChecks: VatCheckScheduler) {}

  handle(event: IntegrationEvent<CenterRegisteredPayload>): Promise<void> {
    return this.vatChecks.schedule(event.payload.centerId, event.correlationId);
  }
}
