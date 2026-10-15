import { Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import { ConsoleTypeOrmLogger, TypeOrmLogger } from './typeorm-logger';

const INSERT =
  'INSERT INTO "origination"."financing_applications"("id", "date_of_birth", "declared_monthly_income_cents") VALUES ($1, $2, $3)';
const PARAMETERS = ['01a14076-e2dd-74fd-a2bb-faffc6e695d8', '1987-02-03', 321_000];

// What pg throws for a refused row: the SQLSTATE, the names involved and the row in `detail`.
function driverError(code: string, message: string): Error {
  return Object.assign(new Error(message), {
    code,
    schema: 'origination',
    table: 'financing_applications',
    constraint: 'ux_origination_financing_applications_open_per_program',
    detail: 'Key (applicant_id, program_id)=(01a1, 01a2) already exists.',
  });
}

const NAMES = {
  name: 'Error',
  schema: 'origination',
  table: 'financing_applications',
  constraint: 'ux_origination_financing_applications_open_per_program',
};

describe('TypeOrmLogger', () => {
  const written: Record<'log' | 'debug' | 'warn', unknown[][]> = { log: [], debug: [], warn: [] };
  const everything = () => JSON.stringify([...written.log, ...written.debug, ...written.warn]);

  beforeEach(() => {
    for (const level of ['log', 'debug', 'warn'] as const) {
      written[level] = [];
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        written[level].push(args);
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should log a unique violation at debug by its names, never the statement or its values', () => {
    const logger = new TypeOrmLogger(false);
    const error = new QueryFailedError(
      INSERT,
      PARAMETERS,
      driverError('23505', 'duplicate key value violates unique constraint'),
    );

    logger.logQueryError(error);

    expect(written.debug).toEqual([
      [
        { ...NAMES, name: 'QueryFailedError', code: '23505' },
        'Query refused by a unique constraint',
      ],
    ]);
    expect(written.warn).toEqual([]);
    expect(everything()).not.toContain('1987-02-03');
    expect(everything()).not.toContain('321000');
    expect(everything()).not.toContain('INSERT');
    expect(everything()).not.toContain('already exists');
  });

  it('should warn about any other refused statement, from a driver error as thrown', () => {
    const logger = new TypeOrmLogger(false);

    logger.logQueryError(driverError('23503', 'violates foreign key constraint'));

    expect(written.warn).toEqual([[{ ...NAMES, code: '23503' }, 'Query failed']]);
    expect(everything()).not.toContain('already exists');
  });

  it('should keep the message of a failure without SQLSTATE, such as a dropped connection', () => {
    new TypeOrmLogger(false).logQueryError(new Error('Connection terminated unexpectedly'));

    expect(written.warn).toEqual([
      [{ name: 'Error', message: 'Connection terminated unexpectedly' }, 'Query failed'],
    ]);
  });

  it('should log statements without their parameters, and only when query logging is on', () => {
    new TypeOrmLogger(false).logQuery(INSERT);
    expect(written.log).toEqual([]);

    new TypeOrmLogger(true).logQuery(INSERT);
    new TypeOrmLogger(true).logQuerySlow(1_200, INSERT);

    expect(written.log).toEqual([[{ query: INSERT }, 'Query']]);
    expect(written.warn).toEqual([[{ durationMs: 1_200, query: INSERT }, 'Slow query']]);
    expect(everything()).not.toContain('1987-02-03');
  });

  it('should keep schema messages quiet and report failed migrations', () => {
    const logger = new TypeOrmLogger(false);

    logger.logSchemaBuild('No migrations are pending');
    logger.logMigration('Migration "AddX" failed, error: boom');
    logger.log('info', 'connected');
    logger.log('warn', 'pool exhausted');

    expect(written.debug).toEqual([['No migrations are pending'], ['connected']]);
    expect(written.warn).toEqual([['Migration "AddX" failed, error: boom'], ['pool exhausted']]);
  });
});

describe('ConsoleTypeOrmLogger', () => {
  let printed: string;

  beforeEach(() => {
    printed = '';
    for (const method of ['log', 'info', 'warn', 'error'] as const) {
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed += `${args.map(String).join(' ')}\n`;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should print failed and logged statements without their parameters', () => {
    const logger = new ConsoleTypeOrmLogger(['query', 'error']);

    logger.logQuery(INSERT, PARAMETERS);
    // TypeORM types the error as a string; at runtime it hands over the driver's Error.
    const thrown = driverError('23505', 'duplicate key value') as unknown as string;
    logger.logQueryError(thrown, INSERT, PARAMETERS);
    logger.logQuerySlow(1_200, INSERT, PARAMETERS);

    expect(printed).toContain('financing_applications');
    expect(printed).toContain('duplicate key value');
    expect(printed).not.toContain('PARAMETERS');
    expect(printed).not.toContain('1987-02-03');
    expect(printed).not.toContain('321000');
  });

  it('should print the schema messages the migrations CLI lists', () => {
    new ConsoleTypeOrmLogger(['error', 'schema']).logSchemaBuild('[ ] AddX202610151200');

    expect(printed).toContain('[ ] AddX202610151200');
  });
});
