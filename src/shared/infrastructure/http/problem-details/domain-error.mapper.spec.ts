import { titleFromCode } from './domain-error.mapper';

describe('titleFromCode', () => {
  it('should read a code as a sentence, keeping acronyms in capitals', () => {
    expect(titleFromCode('invalid_state_transition')).toBe('Invalid state transition');
    expect(titleFromCode('invalid_api_key')).toBe('Invalid API key');
    expect(titleFromCode('center_vat_number_locked')).toBe('Center VAT number locked');
    expect(titleFromCode('iban_invalid')).toBe('IBAN invalid');
  });
});
