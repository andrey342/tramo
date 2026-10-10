import { type EventBus, type UnitOfWork } from '@shared/application';
import { type AggregateRoot, type DomainEvent } from '@shared/domain';

// Runs the work directly. Handlers are unit tested for decisions, not for atomicity; rollback
// behaviour is covered by the integration tests of the real unit of work.
export class InlineUnitOfWork implements UnitOfWork {
  runs = 0;

  run<T>(work: () => Promise<T>): Promise<T> {
    this.runs += 1;
    return work();
  }
}

export class RecordingEventBus implements EventBus {
  readonly published: DomainEvent[] = [];

  publish(events: readonly DomainEvent[]): Promise<void> {
    this.published.push(...events);
    return Promise.resolve();
  }

  ofType(eventType: string): DomainEvent[] {
    return this.published.filter((event) => event.eventType === eventType);
  }
}

// Base for the in-memory repositories of every module: saving bumps the version and hands the
// aggregate's events to the bus, as the real repositories do through the outbox.
export abstract class InMemoryRepository<T extends AggregateRoot> {
  protected readonly items = new Map<string, T>();

  constructor(private readonly events: EventBus) {}

  async save(aggregate: T): Promise<void> {
    this.items.set(aggregate.id, aggregate);
    aggregate.markPersisted(aggregate.version + 1);
    await this.events.publish(aggregate.pullEvents());
  }

  all(): T[] {
    return [...this.items.values()];
  }

  findById(id: string): Promise<T | null> {
    return Promise.resolve(this.items.get(id) ?? null);
  }
}
