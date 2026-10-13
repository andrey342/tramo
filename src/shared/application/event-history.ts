import { type IntegrationEvent } from './event-subscriber';

export const EVENT_HISTORY = Symbol('EVENT_HISTORY');

// Every event ever recorded, in the order it happened (the outbox keeps them after publishing).
// Read models rebuild themselves from it: a projection is disposable, the history is not. Meant
// for projections only: payloads hold what each module published, personal data included.
export interface EventHistory {
  // Up to `limit` events of the given types after `afterId` (an event id), oldest first.
  read(
    eventTypes: readonly string[],
    afterId: string | null,
    limit: number,
  ): Promise<readonly IntegrationEvent[]>;
}
