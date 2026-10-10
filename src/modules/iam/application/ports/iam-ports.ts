import { type Role } from '@shared/domain';

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const ACCESS_TOKEN_ISSUER = Symbol('ACCESS_TOKEN_ISSUER');
export const CREDENTIAL_GENERATOR = Symbol('CREDENTIAL_GENERATOR');
export const LOGIN_ATTEMPTS = Symbol('LOGIN_ATTEMPTS');
export const SESSION_SETTINGS = Symbol('SESSION_SETTINGS');

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
  // True when the hash was produced with weaker parameters than the current ones.
  needsRehash(hash: string): boolean;
  // A valid hash of an unguessable password, verified when the account does not exist so that
  // "unknown email" and "wrong password" take the same time.
  readonly decoyHash: string;
}

export interface AccessTokenClaims {
  readonly userId: string;
  readonly roles: readonly Role[];
  readonly centerId: string | null;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
  readonly expiresInSeconds: number;
}

export interface AccessTokenIssuer {
  issue(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
}

export interface GeneratedSecret {
  // Returned to the client once; never stored.
  readonly value: string;
  readonly hash: string;
}

export interface GeneratedApiKey extends GeneratedSecret {
  readonly prefix: string;
}

// Opaque credentials are high-entropy random strings, so a fast hash (SHA-256) is enough to store
// them; password hashing is only needed for low-entropy secrets chosen by people.
export interface CredentialGenerator {
  refreshToken(): GeneratedSecret;
  apiKey(): GeneratedApiKey;
  hash(value: string): string;
}

// Progressive lockout per account after repeated failed sign-ins.
export interface LoginAttemptTracker {
  // Checks the lock and counts this attempt as failed in one atomic step, so parallel attempts
  // cannot all get past the threshold. Returns the seconds until the account may try again, or 0
  // when this attempt may proceed.
  begin(account: string): Promise<number>;
  // The attempt succeeded: forgets the failures and any lock.
  succeeded(account: string): Promise<void>;
}

export interface SessionSettings {
  // Lifetime of one refresh token; each rotation issues a new one.
  readonly refreshTokenTtlMs: number;
  // Absolute lifetime of a session, however often it is refreshed.
  readonly sessionMaxLifetimeMs: number;
}

export const CENTER_DIRECTORY = Symbol('CENTER_DIRECTORY');

// Training centers belong to the catalog module; iam only needs to know that one exists before
// giving it users or API keys.
export interface CenterDirectory {
  exists(centerId: string): Promise<boolean>;
}
