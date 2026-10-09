import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { AggregatePersister } from '@shared/infrastructure/database/aggregate-persister';

import { type RefreshToken, type RefreshTokenRepository } from '../../domain';

import { RefreshTokenMapper } from './iam.mappers';
import { RefreshTokenOrmEntity } from './refresh-token.orm-entity';

@Injectable()
export class TypeOrmRefreshTokenRepository implements RefreshTokenRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findByTokenHash(tokenHash: string): Promise<RefreshToken | null> {
    const row = await this.txHost.tx.findOneBy(RefreshTokenOrmEntity, { tokenHash });
    return row ? RefreshTokenMapper.toDomain(row) : null;
  }

  save(token: RefreshToken): Promise<void> {
    return this.persister.save(
      RefreshTokenOrmEntity,
      token,
      RefreshTokenMapper.toRow(token),
      'RefreshToken',
    );
  }

  // One statement for the whole family. Bumping the version makes any concurrent rotation of a
  // token in the family fail its optimistic check instead of resurrecting it.
  async revokeFamily(familyId: string, now: Date): Promise<number> {
    const rows: unknown[] = await this.txHost.tx.query(
      `UPDATE iam.refresh_tokens
          SET status = 'revoked', used_at = COALESCE(used_at, $2), version = version + 1
        WHERE family_id = $1 AND status <> 'revoked'
        RETURNING id`,
      [familyId, now],
    );
    return rows.length;
  }
}
