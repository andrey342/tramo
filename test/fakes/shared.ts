import { type EventBus, type UnitOfWork } from '@shared/application';
import { type DomainEvent } from '@shared/domain';

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
