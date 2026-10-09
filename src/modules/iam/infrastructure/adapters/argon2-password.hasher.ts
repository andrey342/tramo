import { randomBytes } from 'node:crypto';

import { Injectable, type OnModuleInit } from '@nestjs/common';
import * as argon2 from 'argon2';

import { type PasswordHasher } from '../../application/ports/iam-ports';

// argon2id with the OWASP minimum (19 MiB, 2 iterations, 1 lane): about 20-40 ms per hash on a
// typical server core. Raising these later only needs a deploy: logins rehash on the next
// successful sign-in (needsRehash).
export const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher, OnModuleInit {
  private decoy: string | undefined;

  async onModuleInit(): Promise<void> {
    this.decoy = await argon2.hash(randomBytes(32).toString('base64url'), ARGON2_OPTIONS);
  }

  get decoyHash(): string {
    if (!this.decoy) {
      throw new Error('Argon2PasswordHasher used before module initialisation.');
    }
    return this.decoy;
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, ARGON2_OPTIONS);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      // A malformed stored hash is a failed verification, not a server error.
      return false;
    }
  }

  needsRehash(hash: string): boolean {
    return argon2.needsRehash(hash, ARGON2_OPTIONS);
  }
}
