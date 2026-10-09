import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { AggregatePersister } from '@shared/infrastructure/database/aggregate-persister';

import { ApiKey, type ApiKeyRepository } from '../../domain';

import { ApiKeyOrmEntity } from './api-key.orm-entity';

function toDomain(row: ApiKeyOrmEntity): ApiKey {
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
}

function toRow(apiKey: ApiKey): Omit<ApiKeyOrmEntity, 'version'> {
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
}

@Injectable()
export class TypeOrmApiKeyRepository implements ApiKeyRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<ApiKey | null> {
    const row = await this.txHost.tx.findOneBy(ApiKeyOrmEntity, { id });
    return row ? toDomain(row) : null;
  }

  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    const row = await this.txHost.tx.findOneBy(ApiKeyOrmEntity, { prefix });
    return row ? toDomain(row) : null;
  }

  async listByCenter(centerId: string): Promise<ApiKey[]> {
    const rows = await this.txHost.tx.find(ApiKeyOrmEntity, {
      where: { centerId },
      order: { createdAt: 'DESC' },
    });
    return rows.map(toDomain);
  }

  async recordUse(id: string, usedAt: Date): Promise<void> {
    await this.txHost.tx.query(
      `UPDATE iam.api_keys SET last_used_at = $2
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2)`,
      [id, usedAt],
    );
  }

  save(apiKey: ApiKey): Promise<void> {
    return this.persister.save(ApiKeyOrmEntity, apiKey, toRow(apiKey), 'ApiKey');
  }
}
