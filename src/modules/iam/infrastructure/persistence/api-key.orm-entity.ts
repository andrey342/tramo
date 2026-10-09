import { Column, Entity, PrimaryColumn } from 'typeorm';

import { type ApiKeyScope } from '@shared/domain';

@Entity({ schema: 'iam', name: 'api_keys' })
export class ApiKeyOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'center_id' })
  centerId: string;

  @Column('text')
  name: string;

  @Column('text')
  prefix: string;

  @Column('text', { name: 'secret_hash' })
  secretHash: string;

  @Column('text', { array: true })
  scopes: ApiKeyScope[];

  @Column('uuid', { name: 'created_by' })
  createdBy: string;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'last_used_at', precision: 3, nullable: true })
  lastUsedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'revoked_at', precision: 3, nullable: true })
  revokedAt: Date | null;

  @Column('integer')
  version: number;
}
