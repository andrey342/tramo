import { Logger } from '@nestjs/common';
import {
  AdvancedConsoleLogger,
  type QueryRunner,
  type Logger as TypeOrmLoggerContract,
} from 'typeorm';

import { driverErrorOf, UNIQUE_VIOLATION } from './database-errors';

// TypeORM's own loggers print a failed statement with its bound parameters, which may hold
// national ids, dates of birth, incomes or emails. Two replacements keep those values out:
// - TypeOrmLogger, for the api and the worker (DatabaseModule): writes through the application
//   logger (pino) what identifies a failure, never the statement or its values;
// - ConsoleTypeOrmLogger, for processes without it (migrations CLI, test setup): TypeORM's console
//   output minus the parameters, so `pnpm migration:verify` still reads `migration:show`.
export class TypeOrmLogger implements TypeOrmLoggerContract {
  private readonly logger = new Logger('Database');

  constructor(private readonly logQueries: boolean) {}

  logQuery(query: string): void {
    if (this.logQueries) {
      this.logger.log({ query }, 'Query');
    }
  }

  // A unique violation is how repositories learn of a duplicate (a second open application for a
  // program is a 409), so it is no fault of the process; anything else may be one.
  logQueryError(error: string | Error): void {
    const failure = describeFailure(error);
    if (failure.code === UNIQUE_VIOLATION) {
      this.logger.debug(failure, 'Query refused by a unique constraint');
      return;
    }
    this.logger.warn(failure, 'Query failed');
  }

  logQuerySlow(time: number, query: string): void {
    this.logger.warn({ durationMs: time, query }, 'Slow query');
  }

  logSchemaBuild(message: string): void {
    this.logger.debug(message);
  }

  // TypeORM reports only failed migrations here; the error itself stops the process.
  logMigration(message: string): void {
    this.logger.warn(message);
  }

  log(level: 'log' | 'info' | 'warn', message: unknown): void {
    if (level === 'warn') {
      this.logger.warn(String(message));
      return;
    }
    this.logger.debug(String(message));
  }
}

export class ConsoleTypeOrmLogger extends AdvancedConsoleLogger {
  override logQuery(query: string, _parameters?: unknown, queryRunner?: QueryRunner): void {
    super.logQuery(query, undefined, queryRunner);
  }

  // Declared as a string by TypeORM; the driver's Error arrives at runtime and prints its message.
  override logQueryError(
    error: string,
    query: string,
    _parameters?: unknown,
    queryRunner?: QueryRunner,
  ): void {
    super.logQueryError(error, query, undefined, queryRunner);
  }

  override logQuerySlow(
    time: number,
    query: string,
    _parameters?: unknown,
    queryRunner?: QueryRunner,
  ): void {
    super.logQuerySlow(time, query, undefined, queryRunner);
  }
}

// The names pg reports (SQLSTATE, schema, table, column, constraint) and the error's name, never
// `detail` (the offending row). The message only when there is no SQLSTATE: a dropped connection
// or a client timeout says what happened in it, while a statement error's may quote a value.
function describeFailure(error: string | Error): Record<string, unknown> {
  if (typeof error === 'string') {
    return { message: error };
  }
  const fields = driverErrorOf(error) ?? {};
  const failure: Record<string, unknown> = { name: error.name };
  for (const key of ['code', 'schema', 'table', 'column', 'constraint'] as const) {
    if (typeof fields[key] === 'string') {
      failure[key] = fields[key];
    }
  }
  if (failure.code === undefined) {
    failure.message = error.message;
  }
  return failure;
}
