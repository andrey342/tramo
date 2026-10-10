import { Email, unwrap } from '@shared/domain';

import { ApiKey, RefreshToken, User } from '../../domain';

import { type ApiKeyOrmEntity } from './api-key.orm-entity';
import { type RefreshTokenOrmEntity } from './refresh-token.orm-entity';
import { type UserOrmEntity } from './user.orm-entity';

export const UserMapper = {
  toDomain(row: UserOrmEntity): User {
    const user = User.reconstitute(row.id, {
      email: unwrap(Email.create(row.email)),
      passwordHash: row.passwordHash,
      roles: row.roles,
      centerId: row.centerId,
      status: row.status,
      createdAt: row.createdAt,
    });
    user.markPersisted(row.version);
    return user;
  },

  toRow(user: User): Omit<UserOrmEntity, 'version'> {
    return {
      id: user.id,
      email: user.email.value,
      passwordHash: user.passwordHash,
      roles: [...user.roles],
      centerId: user.centerId,
      status: user.status,
      createdAt: user.createdAt,
    };
  },
};

export const RefreshTokenMapper = {
  toDomain(row: RefreshTokenOrmEntity): RefreshToken {
    const token = RefreshToken.reconstitute(row.id, {
      familyId: row.familyId,
      userId: row.userId,
      tokenHash: row.tokenHash,
      status: row.status,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      familyExpiresAt: row.familyExpiresAt,
      usedAt: row.usedAt,
    });
    token.markPersisted(row.version);
    return token;
  },

  toRow(token: RefreshToken): Omit<RefreshTokenOrmEntity, 'version'> {
    return {
      id: token.id,
      familyId: token.familyId,
      userId: token.userId,
      tokenHash: token.tokenHash,
      status: token.status,
      issuedAt: token.issuedAt,
      expiresAt: token.expiresAt,
      familyExpiresAt: token.familyExpiresAt,
      usedAt: token.usedAt,
    };
  },
};

export const ApiKeyMapper = {
  toDomain(row: ApiKeyOrmEntity): ApiKey {
    const apiKey = ApiKey.reconstitute(row.id, {
      centerId: row.centerId,
      name: row.name,
      prefix: row.prefix,
      secretHash: row.secretHash,
      scopes: row.scopes,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      revokedAt: row.revokedAt,
    });
    apiKey.markPersisted(row.version);
    return apiKey;
  },

  toRow(apiKey: ApiKey): Omit<ApiKeyOrmEntity, 'version'> {
    return {
      id: apiKey.id,
      centerId: apiKey.centerId,
      name: apiKey.name,
      prefix: apiKey.prefix,
      secretHash: apiKey.secretHash,
      scopes: [...apiKey.scopes],
      createdBy: apiKey.createdBy,
      createdAt: apiKey.createdAt,
      lastUsedAt: apiKey.lastUsedAt,
      revokedAt: apiKey.revokedAt,
    };
  },
};
