import { InvalidValueError } from './domain-error';
import { err, ok, type Result } from './result';
import { ValueObject } from './value-object';

export type NationalIdKind = 'DNI' | 'NIE';

const CONTROL_LETTERS = 'TRWAGMYFPDXBNJZSQVHLCKE';
const DNI_PATTERN = /^(\d{8})([A-Z])$/;
const NIE_PATTERN = /^([XYZ])(\d{7})([A-Z])$/;
const NIE_PREFIX: Readonly<Record<string, string>> = { X: '0', Y: '1', Z: '2' };

// Spanish identity document: DNI (8 digits + letter) or NIE (X/Y/Z + 7 digits + letter). The
// letter is the number modulo 23 looked up in CONTROL_LETTERS; a NIE swaps X/Y/Z for 0/1/2 first.
export class NationalId extends ValueObject<{ value: string; kind: NationalIdKind }> {
  private constructor(value: string, kind: NationalIdKind) {
    super({ value, kind });
  }

  static create(raw: string): Result<NationalId, InvalidValueError> {
    const value = raw.replace(/[\s-]/g, '').toUpperCase();

    const dni = DNI_PATTERN.exec(value);
    if (dni?.[1] && dni[2]) {
      return NationalId.verify(value, 'DNI', dni[1], dni[2]);
    }
    const nie = NIE_PATTERN.exec(value);
    if (nie?.[1] && nie[2] && nie[3]) {
      return NationalId.verify(value, 'NIE', `${NIE_PREFIX[nie[1]] ?? ''}${nie[2]}`, nie[3]);
    }
    return err(new InvalidValueError('nationalId', 'National id must be a DNI or NIE.'));
  }

  private static verify(
    value: string,
    kind: NationalIdKind,
    digits: string,
    letter: string,
  ): Result<NationalId, InvalidValueError> {
    if (CONTROL_LETTERS[Number(digits) % 23] !== letter) {
      return err(new InvalidValueError('nationalId', `${kind} control letter does not match.`));
    }
    return ok(new NationalId(value, kind));
  }

  get value(): string {
    return this.props.value;
  }

  get kind(): NationalIdKind {
    return this.props.kind;
  }

  // The last digit of the number drives the deterministic scenarios of the fake providers.
  get lastDigit(): number {
    return Number(this.value.charAt(this.value.length - 2));
  }

  masked(): string {
    return `${'*'.repeat(this.value.length - 4)}${this.value.slice(-4)}`;
  }

  override toString(): string {
    return this.masked();
  }
}
