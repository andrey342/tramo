import { type Clock } from '@shared/domain';

import {
  type AccessTokenClaims,
  type AccessTokenIssuer,
  type CenterDirectory,
  type CredentialGenerator,
  type GeneratedApiKey,
  type GeneratedSecret,
  type IssuedAccessToken,
  type LoginAttemptTracker,
  type PasswordHasher,
} from '../../src/modules/iam/application/ports/iam-ports';
import {
  ApiKey,
  type ApiKeyRepository,
  RefreshToken,
  type RefreshTokenRepository,
  type User,
  type UserRepository,
} from '../../src/modules/iam/domain';

import { InMemoryRepository } from './shared';

export class InMemoryUserRepository extends InMemoryRepository<User> implements UserRepository {
  findByEmail(email: string): Promise<User | null> {
    return Promise.resolve(this.all().find((user) => user.email.value === email) ?? null);
  }
}

export class InMemoryRefreshTokenRepository
  extends InMemoryRepository<RefreshToken>
  implements RefreshTokenRepository
{
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    return Promise.resolve(this.all().find((token) => token.tokenHash === tokenHash) ?? null);
  }

  // Single-threaded: there is nothing to serialise.
  lockFamily(): Promise<void> {
    return Promise.resolve();
  }

  // Mirrors the bulk UPDATE of the real repository: every non-revoked token of the family is
  // stored again as revoked.
  revokeFamily(familyId: string, now: Date): Promise<number> {
    let revoked = 0;
    for (const token of this.all()) {
      if (token.familyId === familyId && token.status !== 'revoked') {
        this.items.set(
          token.id,
          RefreshToken.reconstitute(token.id, {
            familyId: token.familyId,
            userId: token.userId,
            tokenHash: token.tokenHash,
            status: 'revoked',
            issuedAt: token.issuedAt,
            expiresAt: token.expiresAt,
            familyExpiresAt: token.familyExpiresAt,
            usedAt: token.usedAt ?? now,
          }),
        );
        revoked += 1;
      }
    }
    return Promise.resolve(revoked);
  }
}

export class InMemoryApiKeyRepository
  extends InMemoryRepository<ApiKey>
  implements ApiKeyRepository
{
  findByPrefix(prefix: string): Promise<ApiKey | null> {
    return Promise.resolve(this.all().find((key) => key.prefix === prefix) ?? null);
  }

  listByCenter(centerId: string): Promise<ApiKey[]> {
    return Promise.resolve(
      this.all()
        .filter((key) => key.centerId === centerId)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    );
  }

  // Mirrors the conditional UPDATE: a use older than the recorded one changes nothing.
  recordUse(id: string, usedAt: Date): Promise<void> {
    const key = this.items.get(id);
    if (key && (key.lastUsedAt === null || key.lastUsedAt < usedAt)) {
      const stored = ApiKey.reconstitute(key.id, {
        centerId: key.centerId,
        name: key.name,
        prefix: key.prefix,
        secretHash: key.secretHash,
        scopes: key.scopes,
        createdBy: key.createdBy,
        createdAt: key.createdAt,
        lastUsedAt: usedAt,
        revokedAt: key.revokedAt,
      });
      stored.markPersisted(key.version);
      this.items.set(id, stored);
    }
    return Promise.resolve();
  }
}

export class FakePasswordHasher implements PasswordHasher {
  readonly decoyHash = 'fake:decoy-password-nobody-has';
  verifications = 0;

  hash(password: string): Promise<string> {
    return Promise.resolve(`fake:${password}`);
  }

  verify(hash: string, password: string): Promise<boolean> {
    this.verifications += 1;
    return Promise.resolve(hash === `fake:${password}` || hash === `fake-old:${password}`);
  }

  needsRehash(hash: string): boolean {
    return hash.startsWith('fake-old:');
  }
}

export class FakeAccessTokenIssuer implements AccessTokenIssuer {
  constructor(private readonly clock: Clock) {}

  issue(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    return Promise.resolve({
      token: `access:${claims.userId}:${claims.roles.join(',')}`,
      expiresAt: new Date(this.clock.now().getTime() + 15 * 60_000),
      expiresInSeconds: 15 * 60,
    });
  }
}

export class SequentialCredentialGenerator implements CredentialGenerator {
  private counter = 0;

  refreshToken(): GeneratedSecret {
    this.counter += 1;
    const value = `rt-${String(this.counter)}`;
    return { value, hash: this.hash(value) };
  }

  apiKey(): GeneratedApiKey {
    this.counter += 1;
    // Same shape as real keys so format checks are exercised.
    const prefix = this.counter.toString(16).padStart(8, '0');
    const value = `tramo_${prefix}_${String(this.counter).padStart(43, 'x')}`;
    return { value, prefix, hash: this.hash(value) };
  }

  hash(value: string): string {
    return `h(${value})`;
  }
}

export interface LockoutPolicy {
  readonly maxFailures: number;
  readonly baseLockSeconds: number;
  readonly maxLockSeconds: number;
}

// Same policy as the Redis implementation, on a controllable clock.
export class InMemoryLoginAttemptTracker implements LoginAttemptTracker {
  private readonly failures = new Map<string, number>();
  private readonly lockedUntil = new Map<string, number>();

  constructor(
    private readonly clock: Clock,
    private readonly policy: LockoutPolicy,
  ) {}

  begin(account: string): Promise<number> {
    const now = this.clock.now().getTime();
    const remainingMs = (this.lockedUntil.get(account) ?? 0) - now;
    if (remainingMs > 0) {
      return Promise.resolve(Math.ceil(remainingMs / 1000));
    }
    const count = (this.failures.get(account) ?? 0) + 1;
    this.failures.set(account, count);
    if (count >= this.policy.maxFailures) {
      const seconds = Math.min(
        this.policy.baseLockSeconds * 2 ** (count - this.policy.maxFailures),
        this.policy.maxLockSeconds,
      );
      this.lockedUntil.set(account, now + seconds * 1000);
    }
    return Promise.resolve(0);
  }

  succeeded(account: string): Promise<void> {
    this.failures.delete(account);
    this.lockedUntil.delete(account);
    return Promise.resolve();
  }
}

// Without a list every center exists, which is what most handler tests want.
export class FakeCenterDirectory implements CenterDirectory {
  constructor(private readonly known?: ReadonlySet<string>) {}

  exists(centerId: string): Promise<boolean> {
    return Promise.resolve(this.known?.has(centerId) ?? true);
  }
}
