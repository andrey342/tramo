import { Column, Entity, PrimaryColumn } from 'typeorm';

import { type RefreshTokenStatus } from '../../domain';

@Entity({ schema: 'iam', name: 'refresh_tokens' })
export class RefreshTokenOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'family_id' })
  familyId: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column('text', { name: 'token_hash' })
  tokenHash: string;

  @Column('text')
  status: RefreshTokenStatus;

  @Column({ type: 'timestamptz', name: 'issued_at', precision: 3 })
  issuedAt: Date;

  @Column({ type: 'timestamptz', name: 'expires_at', precision: 3 })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'family_expires_at', precision: 3 })
  familyExpiresAt: Date;

  @Column({ type: 'timestamptz', name: 'used_at', precision: 3, nullable: true })
  usedAt: Date | null;

  @Column('integer')
  version: number;
}
