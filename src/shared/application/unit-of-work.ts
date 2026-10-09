export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

// Everything awaited inside `run` shares one database transaction: aggregate writes and the
// outbox rows for their events commit or roll back together. Nested calls join the outer
// transaction.
export interface UnitOfWork {
  run<T>(work: () => Promise<T>): Promise<T>;
}
