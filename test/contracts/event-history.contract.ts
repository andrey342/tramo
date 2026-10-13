import { uuidv7 } from 'uuidv7';

import { type EventHistory, type IntegrationEvent } from '../../src/shared/application';

export interface EventHistoryHarness {
  readonly history: EventHistory;
  // Records events as the outbox would, ids in this order; each call is one transaction. Where
  // they are stored is the store's business: a table returns rows in no particular order.
  readonly record: (events: readonly Omit<IntegrationEvent, 'eventId'>[]) => Promise<void>;
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

// The history of the unit tests and the outbox agree: events of the asked types, oldest first,
// a page after a given event at a time.
export function eventHistoryContract(
  name: string,
  create: () => Promise<EventHistoryHarness> | EventHistoryHarness,
): void {
  describe(`${name} (EventHistory contract)`, () => {
    it('should page through the events of the asked types, oldest first', async () => {
      const { history, record, run } = await create();
      // Types of their own, so events of other tests sharing the outbox do not interfere.
      const [kept, other] = [`Kept${uuidv7().slice(-8)}`, `Other${uuidv7().slice(-8)}`];
      const event = (eventType: string, n: number) => ({
        eventType,
        aggregateType: 'Contract',
        aggregateId: uuidv7(),
        occurredAt: new Date(Date.UTC(2026, 10, 12, 8, 0, n)).toISOString(),
        correlationId: null,
        payload: { n },
      });
      await record([event(kept, 1), event(other, 2), event(kept, 3), event(kept, 4)]);

      const first = await run(() => history.read([kept], null, 2));
      const second = await run(() => history.read([kept], first.at(-1)?.eventId ?? null, 2));

      expect(first.map((item) => item.payload)).toEqual([{ n: 1 }, { n: 3 }]);
      expect(second.map((item) => item.payload)).toEqual([{ n: 4 }]);
      expect(second[0]).toMatchObject({
        eventType: kept,
        aggregateType: 'Contract',
        occurredAt: new Date(Date.UTC(2026, 10, 12, 8, 0, 4)).toISOString(),
      });
    });

    // The order is the event ids', not the order rows happen to be stored or returned in.
    it('should return the events in id order when they were recorded in several transactions', async () => {
      const { history, record, run } = await create();
      const type = `Sorted${uuidv7().slice(-8)}`;
      const event = (n: number) => ({
        eventType: type,
        aggregateType: 'Contract',
        aggregateId: uuidv7(),
        occurredAt: new Date(Date.UTC(2026, 10, 12, 9, 0, n)).toISOString(),
        correlationId: null,
        payload: { n },
      });
      for (const n of [1, 2, 3]) {
        await record([event(n)]);
      }

      const all = await run(() => history.read([type], null, 10));

      expect(all.map((item) => item.payload)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
      expect(all.map((item) => item.eventId)).toEqual([...all.map((item) => item.eventId)].sort());
    });
  });
}
