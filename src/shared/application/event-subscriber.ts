import { SetMetadata } from '@nestjs/common';

import { type EventPayload } from '@shared/domain';

export const EVENT_SUBSCRIBER = Symbol('EVENT_SUBSCRIBER');

// What a consumer receives: the stored domain event plus delivery metadata. `eventId` is stable
// across redeliveries and is the key consumers deduplicate on.
export interface IntegrationEvent<P extends EventPayload = EventPayload> {
  readonly eventId: string;
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: string;
  readonly correlationId: string | null;
  readonly payload: P;
}

export interface EventHandler<P extends EventPayload = EventPayload> {
  handle(event: IntegrationEvent<P>): Promise<void>;
}

export interface EventSubscription {
  readonly event: string;
  // `<module>.<name>`, e.g. `origination.start-verification`. The module part selects the queue
  // the deliveries go to, the whole name identifies the consumer for idempotency.
  readonly consumer: string;
}

const CONSUMER_NAME = /^[a-z]+\.[a-z0-9-]+$/;

// Marks a provider as the handler of one event type. Each subscriber gets its own copy of every
// matching event, processed exactly once (claim + effects in one unit of work).
export const EventSubscriber = (subscription: EventSubscription): ClassDecorator => {
  if (!CONSUMER_NAME.test(subscription.consumer)) {
    throw new Error(`Consumer "${subscription.consumer}" must look like "<module>.<name>".`);
  }
  return SetMetadata(EVENT_SUBSCRIBER, subscription);
};
