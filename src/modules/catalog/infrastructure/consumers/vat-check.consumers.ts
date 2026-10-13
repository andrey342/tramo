import { Injectable } from '@nestjs/common';

import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import {
  CatalogEvents,
  type CenterRegisteredPayload,
  type CenterReturnedToVerificationPayload,
  type CenterVatNumberChangedPayload,
} from '../../domain';
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

// A corrected VAT number is checked like a new one.
@Injectable()
@EventSubscriber({
  event: CatalogEvents.CenterVatNumberChanged,
  consumer: 'catalog.verify-changed-center-vat',
})
export class VerifyChangedCenterVatConsumer implements EventHandler<CenterVatNumberChangedPayload> {
  constructor(private readonly vatChecks: VatCheckScheduler) {}

  handle(event: IntegrationEvent<CenterVatNumberChangedPayload>): Promise<void> {
    return this.vatChecks.schedule(event.payload.centerId, event.correlationId, event.eventId);
  }
}

// A reinstated center without a valid number is checked again: a check that ended invalid is
// not retried on its own, and the registry may know the number by now.
@Injectable()
@EventSubscriber({
  event: CatalogEvents.CenterReturnedToVerification,
  consumer: 'catalog.verify-reinstated-center-vat',
})
export class VerifyReinstatedCenterVatConsumer implements EventHandler<CenterReturnedToVerificationPayload> {
  constructor(private readonly vatChecks: VatCheckScheduler) {}

  handle(event: IntegrationEvent<CenterReturnedToVerificationPayload>): Promise<void> {
    return this.vatChecks.schedule(event.payload.centerId, event.correlationId, event.eventId);
  }
}
