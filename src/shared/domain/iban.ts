import { InvalidValueError } from './domain-error';
import { err, ok, type Result } from './result';
import { ValueObject } from './value-object';

const IBAN_PATTERN = /^([A-Z]{2})(\d{2})([A-Z0-9]{11,30})$/;
// Lengths of the countries Tramo pays out to; other IBANs only get the generic checks.
const LENGTH_BY_COUNTRY: Readonly<Record<string, number>> = { ES: 24, DE: 22 };

// International bank account number, checked with the ISO 13616 mod-97 rule: move the first
// four characters to the end, replace letters by numbers (A = 10 ... Z = 35), and the result
// modulo 97 must be 1. Shown and logged masked; the full value only leaves for a payout.
export class Iban extends ValueObject<{ value: string }> {
  private constructor(value: string) {
    super({ value });
  }

  static create(raw: string): Result<Iban, InvalidValueError> {
    const value = raw.replace(/[\s-]/g, '').toUpperCase();
    const match = IBAN_PATTERN.exec(value);
    if (!match?.[1]) {
      return err(new InvalidValueError('iban', 'IBAN format is not valid.'));
    }
    const expectedLength = LENGTH_BY_COUNTRY[match[1]];
    if (expectedLength !== undefined && value.length !== expectedLength) {
      return err(
        new InvalidValueError(
          'iban',
          `A ${match[1]} IBAN has ${String(expectedLength)} characters.`,
        ),
      );
    }
    if (mod97(`${value.slice(4)}${value.slice(0, 4)}`) !== 1) {
      return err(new InvalidValueError('iban', 'IBAN check digits do not match.'));
    }
    return ok(new Iban(value));
  }

  get value(): string {
    return this.props.value;
  }

  get countryCode(): string {
    return this.value.slice(0, 2);
  }

  get lastFour(): string {
    return this.value.slice(-4);
  }

  masked(): string {
    return `${this.value.slice(0, 4)} **** ${this.lastFour}`;
  }

  override toString(): string {
    return this.masked();
  }
}

// Digit by digit, so the 30+ digit number never has to fit in a float.
function mod97(rearranged: string): number {
  let remainder = 0;
  for (const char of rearranged) {
    const digits = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder;
}
