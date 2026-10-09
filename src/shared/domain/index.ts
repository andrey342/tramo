export { AggregateRoot } from './aggregate-root';
export { CLOCK, type Clock, FixedClock } from './clock';
export { DateRange } from './date-range';
export {
  DomainError,
  type DomainErrorCategory,
  EntityNotFoundError,
  InvalidStateTransitionError,
  InvalidValueError,
} from './domain-error';
export { type DomainEvent, type EventPayload, type JsonValue } from './domain-event';
export { Email } from './email';
export { Entity } from './entity';
export { type Currency, Money, type Rounding } from './money';
export { NationalId, type NationalIdKind } from './national-id';
export { Percentage } from './percentage';
export { err, type Err, ok, type Ok, type Result, unwrap } from './result';
export { ValueObject } from './value-object';
