// A fact that already happened. Names are in the past tense (ApplicationSubmitted) and payloads
// are plain JSON so the outbox can store them and other modules can read them without importing
// this module's classes.
export type JsonValue =
  string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type EventPayload = Readonly<Record<string, JsonValue>>;

export interface DomainEvent<P extends EventPayload = EventPayload> {
  readonly eventType: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly occurredAt: Date;
  readonly payload: P;
}
