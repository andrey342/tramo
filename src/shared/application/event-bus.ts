import { type DomainEvent } from '@shared/domain';

export const EVENT_BUS = Symbol('EVENT_BUS');

// Publishing is transactional: events are stored with the state change that produced them and
// delivered to subscribers afterwards (transactional outbox, ADR 004). Must be called inside a
// unit of work.
export interface EventBus {
  publish(events: readonly DomainEvent[]): Promise<void>;
}
