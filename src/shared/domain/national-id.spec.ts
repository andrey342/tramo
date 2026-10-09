import { NationalId } from './national-id';
import { unwrap } from './result';

describe('NationalId', () => {
  it.each([
    ['12345678Z', 'DNI'],
    ['00000000T', 'DNI'],
    ['X1234567L', 'NIE'],
    ['Y1234567X', 'NIE'],
    ['Z1234567R', 'NIE'],
  ])('should accept %s as a valid %s', (raw, kind) => {
    const result = NationalId.create(raw);

    expect(result.ok && result.value.kind).toBe(kind);
  });

  it('should normalise case, spaces and hyphens', () => {
    expect(unwrap(NationalId.create(' 12345678-z ')).value).toBe('12345678Z');
  });

  it.each(['12345678A', 'X1234567A'])(
    'should reject %s when the control letter is wrong',
    (raw) => {
      const result = NationalId.create(raw);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.error.message).toContain('control letter');
    },
  );

  it.each(['', '1234567Z', 'A1234567L', '123456789Z'])(
    'should reject malformed input %p',
    (raw) => {
      expect(NationalId.create(raw).ok).toBe(false);
    },
  );

  it('should mask all but the last four characters', () => {
    const id = unwrap(NationalId.create('12345678Z'));

    expect(id.masked()).toBe('*****678Z');
    expect(String(id)).toBe('*****678Z');
  });

  it('should expose the last digit of the number', () => {
    expect(unwrap(NationalId.create('12345678Z')).lastDigit).toBe(8);
  });
});
