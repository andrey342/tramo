import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, LessThan, Not } from 'typeorm';

import {
  AggregatePersister,
  isUniqueViolation,
} from '@shared/infrastructure/database/aggregate-persister';

import {
  ApplicationAlreadyOpenError,
  type FinancingApplication,
  type FinancingApplicationRepository,
} from '../../domain';

import { FinancingApplicationOrmEntity } from './financing-application.orm-entity';
import { FinancingApplicationMapper } from './origination.mappers';

// Final, or waiting for an analyst: never expired (FinancingApplication.isStale).
const NOT_EXPIRING = [
  'rejected',
  'offer_accepted',
  'cancelled',
  'expired',
  'needs_review',
] as const;

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

  async save(application: FinancingApplication): Promise<void> {
    try {
      await this.persister.save(
        FinancingApplicationOrmEntity,
        application,
        this.mapper.toRow(application),
        'FinancingApplication',
      );
    } catch (error) {
      if (isUniqueViolation(error, 'ux_origination_financing_applications_open_per_program')) {
        throw new ApplicationAlreadyOpenError(application.program.programId);
      }
      throw error;
    }
  }

  // Served by ix_origination_financing_applications_expiring_last_activity_at.
  async findStaleIds(before: Date, limit: number): Promise<string[]> {
    const rows = await this.txHost.tx.find(FinancingApplicationOrmEntity, {
      select: { id: true },
      where: { status: Not(In([...NOT_EXPIRING])), lastActivityAt: LessThan(before) },
      order: { lastActivityAt: 'ASC', id: 'ASC' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }
}
