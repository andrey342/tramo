import { censor, maskEmail, maskTail } from './redaction';

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
});
