import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { AggregatePersister } from '@shared/infrastructure/database/aggregate-persister';

import { type ApiKey, type ApiKeyRepository } from '../../domain';

import { ApiKeyOrmEntity } from './api-key.orm-entity';
import { ApiKeyMapper } from './iam.mappers';

@Injectable()
export class TypeOrmApiKeyRepository implements ApiKeyRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<ApiKey | null> {
    const row = await this.txHost.tx.findOneBy(ApiKeyOrmEntity, { id });
    return row ? ApiKeyMapper.toDomain(row) : null;
  }

  async findByPrefix(prefix: string): Promise<ApiKey | null> {
    const row = await this.txHost.tx.findOneBy(ApiKeyOrmEntity, { prefix });
    return row ? ApiKeyMapper.toDomain(row) : null;
  }

  async listByCenter(centerId: string): Promise<ApiKey[]> {
    const rows = await this.txHost.tx.find(ApiKeyOrmEntity, {
      where: { centerId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => ApiKeyMapper.toDomain(row));
  }

  async recordUse(id: string, usedAt: Date): Promise<void> {
    await this.txHost.tx.query(
      `UPDATE iam.api_keys SET last_used_at = $2
        WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < $2)`,
      [id, usedAt],
    );
  }

  save(apiKey: ApiKey): Promise<void> {
    return this.persister.save(ApiKeyOrmEntity, apiKey, ApiKeyMapper.toRow(apiKey), 'ApiKey');
  }
}
