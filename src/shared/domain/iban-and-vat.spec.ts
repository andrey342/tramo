import { InvalidValueError } from './domain-error';
import { Iban } from './iban';
import { unwrap } from './result';
import { VatNumber } from './vat-number';

describe('Iban', () => {
  it('should accept valid Spanish and German IBANs, written with spaces', () => {
    expect(unwrap(Iban.create('es91 2100 0418 4502 0005 1332')).value).toBe(
      'ES9121000418450200051332',
    );
    expect(unwrap(Iban.create('DE89 3704 0044 0532 0130 00')).countryCode).toBe('DE');
  });

  it('should reject a wrong check digit, a wrong length and a malformed value', () => {
    expect(Iban.create('ES9121000418450200051333')).toEqual({
      ok: false,
      error: expect.any(InvalidValueError) as InvalidValueError,
    });
    expect(Iban.create('ES91210004184502000513').ok).toBe(false);
    expect(Iban.create('not an iban').ok).toBe(false);
  });

  it('should show only the country, check digits and last four characters', () => {
    const iban = unwrap(Iban.create('ES9121000418450200051332'));

    expect(iban.masked()).toBe('ES91 **** 1332');
    expect(String(iban)).toBe('ES91 **** 1332');
    expect(iban.lastFour).toBe('1332');
  });
});

describe('VatNumber', () => {
  it('should normalise the number and drop a repeated country prefix', () => {
    const vat = unwrap(VatNumber.create('ES', 'es-b12.345.678'));

    expect(vat.number).toBe('B12345678');
    expect(unwrap(VatNumber.create('ES', 'ESB12345678')).equals(vat)).toBe(true);
    expect(String(vat)).toBe('ESB12345678');
  });

  it('should reject unsupported countries and malformed numbers', () => {
    expect(VatNumber.create('FR', '12345678901').ok).toBe(false);
    expect(VatNumber.create('ES', 'B').ok).toBe(false);
    expect(VatNumber.create('DE', '1234567890123').ok).toBe(false);
  });

  // Before, any 2 to 12 letters or digits passed in either country.
  it.each([
    ['ES', 'B1234567', 'one character short'],
    ['ES', 'B12345678X', 'one character long'],
    ['ES', 'BB2345678', 'a letter among the digits'],
    ['DE', '12345678', 'eight digits'],
    ['DE', 'B12345678', 'a Spanish shape'],
    ['DE', '1234567890', 'ten digits'],
  ])('should refuse the %s tax id %s with %s', (country, number) => {
    expect(VatNumber.create(country, number)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'invalid_value', field: 'taxId' }) as object,
    });
  });

  it("should accept each country's own shape", () => {
    expect(unwrap(VatNumber.create('ES', 'B12345678')).number).toBe('B12345678');
    expect(unwrap(VatNumber.create('ES', '12345678Z')).number).toBe('12345678Z');
    expect(unwrap(VatNumber.create('ES', 'X1234567L')).number).toBe('X1234567L');
    expect(unwrap(VatNumber.create('DE', 'DE 811 569 869')).number).toBe('811569869');
  });

  it("should accept the VIES test service's numbers only when the registry is that service", () => {
    const allowed = { registryTestNumbers: true };

    expect(unwrap(VatNumber.create('ES', '100', allowed)).number).toBe('100');
    expect(unwrap(VatNumber.create('DE', 'DE200', allowed)).number).toBe('200');
    expect(VatNumber.create('ES', '100').ok).toBe(false);
    expect(VatNumber.create('ES', '1000', allowed).ok).toBe(false);
  });

  it('should load a stored number of a country no longer offered', () => {
    expect(String(VatNumber.reconstitute('FR', '12345678901'))).toBe('FR12345678901');
  });
});
