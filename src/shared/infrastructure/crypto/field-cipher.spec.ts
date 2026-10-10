import { createCipheriv, randomBytes } from 'node:crypto';

import { type AppConfig } from '../config';

import { FieldCipher, FieldDecryptionError } from './field-cipher';

const cipherWith = (key: Buffer): FieldCipher =>
  new FieldCipher({
    crypto: { fieldEncryptionKey: key.toString('base64') },
  } as AppConfig);

const IBAN = 'ES9121000418450200051332';
const HERE = 'catalog.training_centers.payout_iban:center-1';

describe('FieldCipher', () => {
  const key = randomBytes(32);

  it('should read back what it wrote, without the plain value in the stored form', () => {
    const cipher = cipherWith(key);

    const stored = cipher.encrypt(IBAN, HERE);

    expect(stored.startsWith('v2.')).toBe(true);
    expect(stored).not.toContain('2100041845');
    expect(cipher.decrypt(stored, HERE)).toBe(IBAN);
  });

  it('should encrypt the same value differently every time', () => {
    const cipher = cipherWith(key);

    expect(cipher.encrypt('same', HERE)).not.toBe(cipher.encrypt('same', HERE));
  });

  it('should refuse a value copied to another row', () => {
    const cipher = cipherWith(key);
    const stored = cipher.encrypt(IBAN, HERE);

    expect(() => cipher.decrypt(stored, 'catalog.training_centers.payout_iban:center-2')).toThrow(
      FieldDecryptionError,
    );
  });

  it('should refuse a modified value, a shortened tag and another key', () => {
    const stored = cipherWith(key).encrypt(IBAN, HERE);
    const [version, iv, tag = '', data = ''] = stored.split('.');
    const flipped = `${data.slice(0, -2)}${data.endsWith('AA') ? 'BB' : 'AA'}`;
    const shortTag = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url');

    expect(() => cipherWith(key).decrypt([version, iv, tag, flipped].join('.'), HERE)).toThrow(
      FieldDecryptionError,
    );
    expect(() => cipherWith(key).decrypt([version, iv, shortTag, data].join('.'), HERE)).toThrow(
      FieldDecryptionError,
    );
    expect(() => cipherWith(randomBytes(32)).decrypt(stored, HERE)).toThrow(FieldDecryptionError);
    expect(() => cipherWith(key).decrypt('plain text', HERE)).toThrow(FieldDecryptionError);
  });

  it('should still read values written before contexts existed', () => {
    const iv = randomBytes(12);
    const legacy = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([legacy.update(IBAN, 'utf8'), legacy.final()]);
    const stored = ['v1', iv, legacy.getAuthTag(), data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
    const cipher = cipherWith(key);

    expect(cipher.decrypt(stored, HERE)).toBe(IBAN);
  });
});
