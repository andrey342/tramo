import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_VERSION = 'v1';

export class FieldDecryptionError extends Error {
  constructor() {
    super('Encrypted field could not be decrypted: wrong key or tampered value.');
    this.name = 'FieldDecryptionError';
  }
}

// Encrypts single column values (payout IBANs, webhook secrets) with AES-256-GCM before they reach
// the database, so a dump or a read-only role does not expose them (ADR 014). Values are stored as
// `v1.<iv>.<tag>.<ciphertext>` in base64url: the version names the key, so the key can rotate by
// adding v2 and re-encrypting. GCM authenticates the value; a modified one fails to decrypt.
@Injectable()
export class FieldCipher {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.crypto.fieldEncryptionKey, 'base64');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [KEY_VERSION, iv, cipher.getAuthTag(), data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(stored: string): string {
    const [version, iv, tag, data] = stored.split('.');
    if (version !== KEY_VERSION || !iv || !tag || data === undefined) {
      throw new FieldDecryptionError();
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new FieldDecryptionError();
    }
  }
}
