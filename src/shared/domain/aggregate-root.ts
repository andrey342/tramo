import { type DomainEvent } from './domain-event';
import { Entity } from './entity';

export abstract class AggregateRoot<Id extends string = string> extends Entity<Id> {
  private pendingEvents: DomainEvent[] = [];
  // Optimistic concurrency: the version this instance was loaded at (0 = never persisted).
  // Repositories update with "WHERE version = :version" and fail on a mismatch.
  private persistedVersion = 0;

  get version(): number {
    return this.persistedVersion;
  }

  markPersisted(version: number): void {
    this.persistedVersion = version;
  }

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
