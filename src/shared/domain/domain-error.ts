// The category tells the outer layers how to react (HTTP status, retry or not) without the
// domain knowing about HTTP. `code` is stable and becomes part of the public error contract.
export type DomainErrorCategory =
  'validation' | 'not_found' | 'conflict' | 'rule_violation' | 'forbidden';

export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly category: DomainErrorCategory;

  protected constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidValueError extends DomainError {
  readonly code = 'invalid_value';
  readonly category = 'validation';

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message, { field });
  }
}

export class InvalidStateTransitionError extends DomainError {
  readonly code = 'invalid_state_transition';
  readonly category = 'conflict';

  constructor(entity: string, from: string, to: string) {
    super(`${entity} cannot move from ${from} to ${to}.`, { entity, from, to });
  }
}

export class EntityNotFoundError extends DomainError {
  readonly code = 'not_found';
  readonly category = 'not_found';

  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found.`, { entity, id });
  }
}
