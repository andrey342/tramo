// Expected failures (invalid user input, a rule that may legitimately not hold) are returned as
// values; broken invariants inside aggregates are thrown as DomainError. See ADR 002.
export type Result<T, E = Error> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });
export const err = <E>(error: E): Err<E> => ({ ok: false, error });

export function unwrap<T, E extends Error>(result: Result<T, E>): T {
  if (!result.ok) {
    throw result.error;
  }
  return result.value;
}
