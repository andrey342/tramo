import { InvalidValueError } from './domain-error';
import { err, ok, type Result } from './result';
import { ValueObject } from './value-object';

// Countries where Tramo signs training centers today.
export const VAT_COUNTRIES = ['ES', 'DE'] as const;
export type VatCountry = (typeof VAT_COUNTRIES)[number];

// The national number after the country prefix: a Spanish NIF, CIF or NIE is a letter or digit,
// seven digits and a letter or digit; a German USt-IdNr is nine digits.
const SHAPES: Readonly<Record<VatCountry, { pattern: RegExp; description: string }>> = {
  ES: {
    pattern: /^[A-Z0-9]\d{7}[A-Z0-9]$/,
    description: 'a letter or digit, 7 digits and a letter or digit',
  },
  DE: { pattern: /^\d{9}$/, description: '9 digits' },
};

// VIES's test service answers by number in every country (100 valid, 200 invalid, 300 and up
// its errors), and none of them has a national shape. They are tax ids only where the registry
// asked is that service or a stand-in for it, which the caller says with `registryTestNumbers`.
const REGISTRY_TEST_NUMBER = /^\d{3}$/;

export interface VatNumberOptions {
  readonly registryTestNumbers?: boolean;
}

// An EU VAT identification number: country plus national number (a Spanish NIF/CIF, a German
// USt-IdNr). Only the shape is checked here; whether the number exists and is active is VIES's
// answer, which also covers national check digits.
export class VatNumber extends ValueObject<{ country: VatCountry; number: string }> {
  private constructor(country: VatCountry, number: string) {
    super({ country, number });
  }

  static create(
    country: string,
    raw: string,
    options: VatNumberOptions = {},
  ): Result<VatNumber, InvalidValueError> {
    if (!(VAT_COUNTRIES as readonly string[]).includes(country)) {
      return err(
        new InvalidValueError('country', `Country must be one of ${VAT_COUNTRIES.join(', ')}.`),
      );
    }
    const compact = raw.replace(/[\s.-]/g, '').toUpperCase();
    // "ESB12345678" and "B12345678" are the same number.
    const number = compact.startsWith(country) ? compact.slice(country.length) : compact;
    const shape = SHAPES[country as VatCountry];
    const testNumber = options.registryTestNumbers === true && REGISTRY_TEST_NUMBER.test(number);
    if (!testNumber && !shape.pattern.test(number)) {
      return err(new InvalidValueError('taxId', `A ${country} tax id is ${shape.description}.`));
    }
    return ok(new VatNumber(country as VatCountry, number));
  }

  // For numbers read back from storage, valid when they were written: accepting fewer countries
  // or shapes later must not make stored records unloadable.
  static reconstitute(country: string, number: string): VatNumber {
    return new VatNumber(country as VatCountry, number);
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
