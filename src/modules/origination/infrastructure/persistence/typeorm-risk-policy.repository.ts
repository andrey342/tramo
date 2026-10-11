import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { ConcurrentModificationError } from '@shared/domain';
import { isUniqueViolation } from '@shared/infrastructure/database/aggregate-persister';

import { type RiskPolicy, type RiskPolicyRepository } from '../../domain';

import { RiskPolicyMapper } from './origination.mappers';
import { RiskPolicyOrmEntity } from './risk-policy.orm-entity';

@Injectable()
export class TypeOrmRiskPolicyRepository implements RiskPolicyRepository {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async findCurrent(): Promise<RiskPolicy | null> {
    const [row] = await this.txHost.tx.find(RiskPolicyOrmEntity, {
      order: { version: 'DESC' },
      take: 1,
    });
    return row ? RiskPolicyMapper.toDomain(row) : null;
  }

  async findByVersion(version: number): Promise<RiskPolicy | null> {
    const row = await this.txHost.tx.findOneBy(RiskPolicyOrmEntity, { version });
    return row ? RiskPolicyMapper.toDomain(row) : null;
  }

  // Two admins revising at once both build the same next version; the second insert loses.
  async add(policy: RiskPolicy): Promise<void> {
    try {
      await this.txHost.tx.insert(RiskPolicyOrmEntity, RiskPolicyMapper.toRow(policy));
    } catch (error) {
      if (isUniqueViolation(error, 'pk_origination_risk_policies')) {
        throw new ConcurrentModificationError('RiskPolicy', String(policy.version));
      }
      throw error;
    }
  }
}
