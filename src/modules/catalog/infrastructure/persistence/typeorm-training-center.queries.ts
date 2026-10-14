import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import { type TrainingCenterDto } from '../../application/dto/training-center.dto';
import { type TrainingCenterQueries } from '../../application/ports/catalog-ports';
import { toTrainingCenterDto } from '../../application/training-center.mapping';
import { type CenterStatus } from '../../domain';

import { TrainingCenterMapper } from './catalog.mappers';
import { TrainingCenterOrmEntity } from './training-center.orm-entity';

// Keyset pagination on (created_at, id). Centers are few (Tramo signs each one), so the table is
// read without an index of its own. Rows go through the mapper, which masks the payout account.
@Injectable()
export class TypeOrmTrainingCenterQueries implements TrainingCenterQueries {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly mapper: TrainingCenterMapper,
  ) {}

  async list(
    filter: { readonly status?: CenterStatus },
    page: PageRequest,
  ): Promise<CursorPage<TrainingCenterDto>> {
    const query = this.txHost.tx
      .getRepository(TrainingCenterOrmEntity)
      .createQueryBuilder('center');
    if (filter.status) {
      query.andWhere('center.status = :status', { status: filter.status });
    }
    const result = await paginateByCursor(query, page, {
      sortColumn: 'center.created_at',
      idColumn: 'center.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return {
      data: result.data.map((row) => toTrainingCenterDto(this.mapper.toDomain(row))),
      nextCursor: result.nextCursor,
    };
  }
}
