export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

// Lets an event consumer act exactly once per event even though delivery is at-least-once.
// `claim` returns false when `key` was already processed by `consumer`. Call it inside the unit of
// work that applies the effects: if the work fails, the claim rolls back with it and a retry can
// claim again.
export interface IdempotencyStore {
  claim(key: string, consumer: string): Promise<boolean>;
}
