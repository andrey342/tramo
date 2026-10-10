import { InvalidValueError } from './domain-error';
import { err, ok, type Result } from './result';
import { ValueObject } from './value-object';

// Countries where Tramo signs training centers today.
export const VAT_COUNTRIES = ['ES', 'DE'] as const;
export type VatCountry = (typeof VAT_COUNTRIES)[number];

const NUMBER_PATTERN = /^[A-Z0-9]{2,12}$/;

// An EU VAT identification number: country plus national number (a Spanish NIF/CIF, a German
// USt-IdNr). Only the shape is checked here; whether the number exists and is active is VIES's
// answer, which also covers national check digits.
export class VatNumber extends ValueObject<{ country: VatCountry; number: string }> {
  private constructor(country: VatCountry, number: string) {
    super({ country, number });
  }

  static create(country: string, raw: string): Result<VatNumber, InvalidValueError> {
    if (!(VAT_COUNTRIES as readonly string[]).includes(country)) {
      return err(
        new InvalidValueError('country', `Country must be one of ${VAT_COUNTRIES.join(', ')}.`),
      );
    }
    const compact = raw.replace(/[\s.-]/g, '').toUpperCase();
    // "ESB12345678" and "B12345678" are the same number.
    const number = compact.startsWith(country) ? compact.slice(country.length) : compact;
    if (!NUMBER_PATTERN.test(number)) {
      return err(new InvalidValueError('taxId', 'Tax id must be 2 to 12 letters or digits.'));
    }
    return ok(new VatNumber(country as VatCountry, number));
  }

  get country(): VatCountry {
    return this.props.country;
  }

  get number(): string {
    return this.props.number;
  }

  override toString(): string {
    return `${this.country}${this.number}`;
  }
}
