import { uuidv7 } from 'uuidv7';

import {
  EmailNotification,
  type EmailTemplate,
  WebhookDelivery,
  type WebhookEvent,
  WebhookSubscription,
} from '../../src/modules/notifications/domain';
import { Email, unwrap } from '../../src/shared/domain';

export const NOW = new Date('2026-11-12T08:00:00Z');
export const LATER = new Date('2026-11-12T09:00:00Z');
export const SINK_URL = 'http://webhook-sink:9099/tramo';
export const SECRET = 'whsec_0123456789abcdef0123456789abcdef';

export function aSubscription(overrides: { centerId?: string; url?: string } = {}) {
  return WebhookSubscription.subscribe({
    id: uuidv7(),
    centerId: overrides.centerId ?? uuidv7(),
    url: overrides.url ?? SINK_URL,
    secret: SECRET,
    now: NOW,
  });
}

export function aDelivery(
  overrides: { centerId?: string; eventId?: string; event?: WebhookEvent } = {},
) {
  const contractId = uuidv7();
  return WebhookDelivery.request({
    id: uuidv7(),
    centerId: overrides.centerId ?? uuidv7(),
    eventId: overrides.eventId ?? uuidv7(),
    event: overrides.event ?? 'contract.signed',
    data: { contractId, disbursementAmountCents: 7_125_00 },
    occurredAt: NOW,
    now: NOW,
  });
}

export function anEmail(
  overrides: { eventId?: string; template?: EmailTemplate; recipient?: string } = {},
) {
  return EmailNotification.request({
    id: uuidv7(),
    eventId: overrides.eventId ?? uuidv7(),
    template: overrides.template ?? 'installment_collected',
    recipient: unwrap(Email.create(overrides.recipient ?? 'student@example.com')),
    reference: uuidv7(),
    data: { amountCents: 337_50 },
    now: NOW,
  });
}
