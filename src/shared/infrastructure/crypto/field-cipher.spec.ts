import { randomBytes } from 'node:crypto';

import { type AppConfig } from '../config';

import { FieldCipher, FieldDecryptionError } from './field-cipher';

const cipherWith = (key: Buffer): FieldCipher =>
  new FieldCipher({
    crypto: { fieldEncryptionKey: key.toString('base64') },
  } as AppConfig);

describe('FieldCipher', () => {
  const key = randomBytes(32);

  it('should read back what it wrote, without the plain value in the stored form', () => {
    const cipher = cipherWith(key);

    const stored = cipher.encrypt('ES9121000418450200051332');

    expect(stored.startsWith('v1.')).toBe(true);
    expect(stored).not.toContain('2100041845');
    expect(cipher.decrypt(stored)).toBe('ES9121000418450200051332');
  });

  it('should encrypt the same value differently every time', () => {
    const cipher = cipherWith(key);

    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('should refuse a modified value and a value encrypted with another key', () => {
    const stored = cipherWith(key).encrypt('ES9121000418450200051332');
    const [version, iv, tag, data = ''] = stored.split('.');
    const flipped = `${data.slice(0, -2)}${data.endsWith('AA') ? 'BB' : 'AA'}`;

    expect(() => cipherWith(key).decrypt([version, iv, tag, flipped].join('.'))).toThrow(
      FieldDecryptionError,
    );
    expect(() => cipherWith(randomBytes(32)).decrypt(stored)).toThrow(FieldDecryptionError);
    expect(() => cipherWith(key).decrypt('plain text')).toThrow(FieldDecryptionError);
  });
});
