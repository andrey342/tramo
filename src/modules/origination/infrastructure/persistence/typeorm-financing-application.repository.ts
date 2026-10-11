import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, LessThan, Not } from 'typeorm';

import { AggregatePersister } from '@shared/infrastructure/database/aggregate-persister';

import { type FinancingApplication, type FinancingApplicationRepository } from '../../domain';

import { FinancingApplicationOrmEntity } from './financing-application.orm-entity';
import { FinancingApplicationMapper } from './origination.mappers';

const FINAL = ['rejected', 'offer_accepted', 'cancelled', 'expired'] as const;

@Injectable()
export class TypeOrmFinancingApplicationRepository implements FinancingApplicationRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
    private readonly mapper: FinancingApplicationMapper,
  ) {}

  async findById(id: string): Promise<FinancingApplication | null> {
    const row = await this.txHost.tx.findOneBy(FinancingApplicationOrmEntity, { id });
    return row ? this.mapper.toDomain(row) : null;
  }

  save(application: FinancingApplication): Promise<void> {
    return this.persister.save(
      FinancingApplicationOrmEntity,
      application,
      this.mapper.toRow(application),
      'FinancingApplication',
    );
  }

  // Served by ix_origination_financing_applications_open_status_changed_at.
  async findStaleIds(before: Date, limit: number): Promise<string[]> {
    const rows = await this.txHost.tx.find(FinancingApplicationOrmEntity, {
      select: { id: true },
      where: { status: Not(In([...FINAL])), statusChangedAt: LessThan(before) },
      order: { statusChangedAt: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}
