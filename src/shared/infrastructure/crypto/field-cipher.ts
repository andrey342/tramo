import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '../config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;
const CURRENT_VERSION = 'v2';

export class FieldDecryptionError extends Error {
  constructor() {
    super('Encrypted field could not be decrypted: wrong key, wrong place or tampered value.');
    this.name = 'FieldDecryptionError';
  }
}

// Encrypts single column values (payout IBANs, webhook secrets) with AES-256-GCM before they reach
// the database, so a dump or a read-only role does not expose them (ADR 014). Stored as
// `v2.<iv>.<tag>.<ciphertext>` in base64url.
//
// `context` names where the value lives (table, column, row id) and is authenticated with it, so a
// ciphertext copied into another row (one center's IBAN into another's) fails to decrypt instead
// of paying the wrong account. `v1` values, written before contexts existed, are still read and
// become `v2` the next time their row is saved (mappers encrypt on every save).
@Injectable()
export class FieldCipher {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.key = Buffer.from(config.crypto.fieldEncryptionKey, 'base64');
  }

  encrypt(plain: string, context: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv, { authTagLength: AUTH_TAG_BYTES });
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [CURRENT_VERSION, iv, cipher.getAuthTag(), data]
      .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
      .join('.');
  }

  decrypt(stored: string, context: string): string {
    const [version, iv, tag, data] = stored.split('.');
    if ((version !== 'v1' && version !== 'v2') || !iv || !tag || data === undefined) {
      throw new FieldDecryptionError();
    }
    const authTag = Buffer.from(tag, 'base64url');
    // A short tag would weaken authentication; only full 16-byte tags are accepted.
    if (authTag.length !== AUTH_TAG_BYTES) {
      throw new FieldDecryptionError();
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(iv, 'base64url'), {
        authTagLength: AUTH_TAG_BYTES,
      });
      if (version === CURRENT_VERSION) {
        decipher.setAAD(Buffer.from(context, 'utf8'));
      }
      decipher.setAuthTag(authTag);
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new FieldDecryptionError();
    }
  }
}
