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

  // A transaction-scoped advisory lock: a revocation that only updated the rows it could see
  // would miss the token a concurrent rotation is inserting, and that token would outlive logout.
  async lockFamily(familyId: string): Promise<void> {
    await this.txHost.tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `iam.refresh_family:${familyId}`,
    ]);
  }

  // One statement for the whole family. Bumping the version makes any rotation that loaded a
  // token before the lock fail its optimistic check instead of resurrecting it.
  async revokeFamily(familyId: string, now: Date): Promise<number> {
    await this.lockFamily(familyId);
    // For UPDATE, TypeORM's Postgres driver answers [rows, affected count], not the rows.
    const [, revoked]: [unknown[], number] = await this.txHost.tx.query(
      `UPDATE iam.refresh_tokens
          SET status = 'revoked', used_at = COALESCE(used_at, $2), version = version + 1
        WHERE family_id = $1 AND status <> 'revoked'`,
      [familyId, now],
    );
    return revoked;
  }

  // Each family is locked as revokeFamily does, in id order so two revocations of the same user
  // queue behind each other instead of deadlocking. A family the user opens meanwhile (a sign-in
  // that read the account before it was disabled) is not seen here; its first refresh finds the
  // account disabled and revokes it.
  async revokeAllOfUser(userId: string, now: Date): Promise<number> {
    const families: { family_id: string }[] = await this.txHost.tx.query(
      `SELECT DISTINCT family_id FROM iam.refresh_tokens
        WHERE user_id = $1 AND status <> 'revoked'
        ORDER BY family_id`,
      [userId],
    );
    for (const { family_id: familyId } of families) {
      await this.lockFamily(familyId);
    }
    const [, revoked]: [unknown[], number] = await this.txHost.tx.query(
      `UPDATE iam.refresh_tokens
          SET status = 'revoked', used_at = COALESCE(used_at, $2), version = version + 1
        WHERE user_id = $1 AND status <> 'revoked'`,
      [userId, now],
    );
    return revoked;
  }
}
