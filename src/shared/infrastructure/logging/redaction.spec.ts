import { pino, stdSerializers } from 'pino';
import { QueryFailedError } from 'typeorm';

import { censor, maskEmail, maskTail, REDACTED_PATHS, scrubError } from './redaction';

describe('log redaction', () => {
  it('should keep only the first letter and the domain of an email', () => {
    expect(maskEmail('ana.garcia@example.com')).toBe('a***@example.com');
  });

  it('should fully redact a value that is not a valid email', () => {
    expect(maskEmail('not-an-email')).toBe('[REDACTED]');
  });

  it('should keep the last four characters of an iban', () => {
    expect(maskTail('ES9121000418450200051332')).toBe('***1332');
  });

  it('should fully redact short values that would otherwise leak entirely', () => {
    expect(maskTail('1234')).toBe('[REDACTED]');
  });

  it('should pick the mask from the redacted key', () => {
    expect(censor('ana@example.com', ['body', 'email'])).toBe('a***@example.com');
    expect(censor('12345678Z', ['body', 'nationalId'])).toBe('***678Z');
    expect(censor('s3cret', ['body', 'password'])).toBe('[REDACTED]');
    expect(censor({ nested: true }, ['body', 'iban'])).toBe('[REDACTED]');
  });

  it('should redact sensitive fields at the top level and nested two levels down', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: { paths: [...REDACTED_PATHS], censor } },
      { write: (line: string) => lines.push(line) },
    );

    logger.info(
      {
        password: 'top secret 1',
        issued: { key: 'tramo_abcd1234_secret' },
        a: { b: { tokenHash: 'h' } },
      },
      'probe',
    );

    const logged = lines.join('');
    expect(logged).not.toContain('top secret 1');
    expect(logged).not.toContain('tramo_abcd1234_secret');
    expect(logged).not.toContain('"tokenHash":"h"');
  });

  it('should drop the sql, parameters and row details of a database error', () => {
    const driverError = Object.assign(new Error('duplicate key value violates unique constraint'), {
      code: '23505',
      detail: 'Key (email)=(ana@example.com) already exists.',
    });
    const error = new QueryFailedError(
      'INSERT INTO iam.users (email, password_hash) VALUES ($1, $2)',
      ['ana@example.com', '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA'],
      driverError,
    );

    const logged = JSON.stringify(scrubError(stdSerializers.err(error)));

    expect(logged).not.toContain('ana@example.com');
    expect(logged).not.toContain('argon2id');
    expect(logged).toContain('duplicate key value');
    expect(logged).toContain('23505');
  });
});
