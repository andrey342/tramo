import { type ApiKey } from '../model/api-key';
import { type RefreshToken } from '../model/refresh-token';
import { type User } from '../model/user';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
export const API_KEY_REPOSITORY = Symbol('API_KEY_REPOSITORY');

// Repositories persist the aggregate and hand its pending events to the outbox in the caller's
// unit of work.
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
}

export interface RefreshTokenRepository {
  findByTokenHash(tokenHash: string): Promise<RefreshToken | null>;
  save(token: RefreshToken): Promise<void>;
  // Rotations and revocations of one family run one at a time, until the unit of work ends.
  // Reads made after taking the lock see what the previous holder committed.
  lockFamily(familyId: string): Promise<void>;
  // Revokes every token of the family that is not revoked yet; returns how many were affected.
  // Takes the family lock first.
  revokeFamily(familyId: string, now: Date): Promise<number>;
}

export interface ApiKeyRepository {
  findById(id: string): Promise<ApiKey | null>;
  findByPrefix(prefix: string): Promise<ApiKey | null>;
  listByCenter(centerId: string): Promise<ApiKey[]>;
  save(key: ApiKey): Promise<void>;
  // Bookkeeping outside optimistic locking: concurrent requests with one key must not conflict.
  recordUse(id: string, usedAt: Date): Promise<void>;
}
