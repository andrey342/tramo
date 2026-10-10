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

  it("should accept the VIES test service's numbers", () => {
    expect(unwrap(VatNumber.create('ES', '100')).number).toBe('100');
  });
});
