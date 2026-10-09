import { createHash, randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  type CredentialGenerator,
  type GeneratedApiKey,
  type GeneratedSecret,
} from '../../application/ports/iam-ports';

export const API_KEY_PATTERN = /^tramo_([0-9a-f]{8})_[A-Za-z0-9_-]{43}$/;

// 256-bit random secrets. API keys look like `tramo_<8 hex prefix>_<secret>`: the prefix finds the
// row and identifies the key in listings and logs, the hash of the whole key authenticates it.
@Injectable()
export class CryptoCredentialGenerator implements CredentialGenerator {
  refreshToken(): GeneratedSecret {
    const value = randomBytes(32).toString('base64url');
    return { value, hash: this.hash(value) };
  }

  apiKey(): GeneratedApiKey {
    const prefix = randomBytes(4).toString('hex');
    const value = `tramo_${prefix}_${randomBytes(32).toString('base64url')}`;
    return { value, prefix, hash: this.hash(value) };
  }

  hash(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}
