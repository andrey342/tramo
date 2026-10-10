import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type VatNumber } from '@shared/domain';
import {
  AggregatePersister,
  isUniqueViolation,
} from '@shared/infrastructure/database/aggregate-persister';

import {
  CenterAlreadyRegisteredError,
  type TrainingCenter,
  type TrainingCenterRepository,
} from '../../domain';

import { TrainingCenterMapper } from './catalog.mappers';
import { TrainingCenterOrmEntity } from './training-center.orm-entity';

@Injectable()
export class TypeOrmTrainingCenterRepository implements TrainingCenterRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
    private readonly mapper: TrainingCenterMapper,
  ) {}

  async findById(id: string): Promise<TrainingCenter | null> {
    const row = await this.txHost.tx.findOneBy(TrainingCenterOrmEntity, { id });
    return row ? this.mapper.toDomain(row) : null;
  }

  async findByVatNumber(vatNumber: VatNumber): Promise<TrainingCenter | null> {
    const row = await this.txHost.tx.findOneBy(TrainingCenterOrmEntity, {
      country: vatNumber.country,
      taxNumber: vatNumber.number,
    });
    return row ? this.mapper.toDomain(row) : null;
  }

  async save(center: TrainingCenter): Promise<void> {
    try {
      await this.persister.save(
        TrainingCenterOrmEntity,
        center,
        this.mapper.toRow(center),
        'TrainingCenter',
      );
    } catch (error) {
      // Two registrations of one tax id can both pass the existence check; the index decides.
      if (isUniqueViolation(error, 'ux_catalog_training_centers_country_tax_number')) {
        throw new CenterAlreadyRegisteredError(center.vatNumber.toString());
      }
      throw error;
    }
  }
}
