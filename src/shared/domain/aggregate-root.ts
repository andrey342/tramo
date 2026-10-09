import { type DomainEvent } from './domain-event';
import { Entity } from './entity';

export abstract class AggregateRoot<Id extends string = string> extends Entity<Id> {
  private pendingEvents: DomainEvent[] = [];

  protected record(event: DomainEvent): void {
    this.pendingEvents.push(event);
  }

  // Called by the repository inside the unit of work, so events reach the outbox in the same
  // transaction as the state change that produced them.
  pullEvents(): readonly DomainEvent[] {
    const events = this.pendingEvents;
    this.pendingEvents = [];
    return events;
  }

  get hasPendingEvents(): boolean {
    return this.pendingEvents.length > 0;
  }
}
