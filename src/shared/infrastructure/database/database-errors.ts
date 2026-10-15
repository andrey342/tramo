// SQLSTATE 23505: a unique index or constraint refused the row.
export const UNIQUE_VIOLATION = '23505';

// What pg puts on its errors besides the message: the SQLSTATE and the objects involved (and the
// offending row in `detail`, which is never read here).
export interface DriverErrorFields {
  readonly code?: unknown;
  readonly schema?: unknown;
  readonly table?: unknown;
  readonly column?: unknown;
  readonly constraint?: unknown;
}

// TypeORM wraps the driver's error in a QueryFailedError (`driverError`); its logger receives the
// driver's error as thrown. Either way, the fields pg set.
export function driverErrorOf(error: unknown): DriverErrorFields | null {
  if (error === null || typeof error !== 'object') {
    return null;
  }
  const { driverError } = error as { driverError?: unknown };
  return typeof driverError === 'object' && driverError !== null ? driverError : error;
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const driverError = driverErrorOf(error);
  return driverError?.code === UNIQUE_VIOLATION && driverError.constraint === constraint;
}
