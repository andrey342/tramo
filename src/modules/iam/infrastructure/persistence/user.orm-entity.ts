import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

import { type Role } from '@shared/domain';

import { type UserStatus } from '../../domain';

@Entity({ schema: 'iam', name: 'users' })
export class UserOrmEntity {
  @PrimaryColumn('uuid')
  id: string;

  @Column('text')
  email: string;

  @Column('text', { name: 'password_hash' })
  passwordHash: string;

  @Column('text', { array: true })
  roles: Role[];

  @Column('uuid', { name: 'center_id', nullable: true })
  centerId: string | null;

  @Column('text')
  status: UserStatus;

  @Column({ type: 'timestamptz', name: 'created_at', precision: 3 })
  createdAt: Date;

  // Bookkeeping for support and audits, not part of the domain: set by the database on insert
  // and by TypeORM on every update.
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at', precision: 3 })
  updatedAt?: Date;

  @Column('integer')
  version: number;
}
