import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import {
  AggregatePersister,
  isUniqueViolation,
} from '@shared/infrastructure/database/aggregate-persister';

import { EmailAlreadyRegisteredError, type User, type UserRepository } from '../../domain';

import { UserMapper } from './iam.mappers';
import { UserOrmEntity } from './user.orm-entity';

@Injectable()
export class TypeOrmUserRepository implements UserRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.txHost.tx.findOneBy(UserOrmEntity, { id });
    return row ? UserMapper.toDomain(row) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.txHost.tx.findOneBy(UserOrmEntity, { email });
    return row ? UserMapper.toDomain(row) : null;
  }

  async save(user: User): Promise<void> {
    try {
      await this.persister.save(UserOrmEntity, user, UserMapper.toRow(user), 'User');
    } catch (error) {
      // Two registrations with the same email can both pass the existence check; the unique
      // index decides, and the loser gets the same error as a sequential duplicate.
      if (isUniqueViolation(error, 'ux_iam_users_email')) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }
}
