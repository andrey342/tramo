import { uuidv7 } from 'uuidv7';

import { type EventHistory, type IntegrationEvent } from '../../src/shared/application';

export interface EventHistoryHarness {
  readonly history: EventHistory;
  // Records events, in this order, as the outbox would.
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
  });
}
