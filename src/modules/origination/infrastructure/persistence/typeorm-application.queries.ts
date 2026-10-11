import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { type SelectQueryBuilder } from 'typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import {
  type ApplicationFilter,
  type ApplicationSummaryDto,
} from '../../application/dto/application.dto';
import { type ApplicationQueries } from '../../application/ports/origination-ports';

import { FinancingApplicationOrmEntity } from './financing-application.orm-entity';

// Lists read only the columns a summary shows and map rows straight to DTOs. Each scope has its
// index on (…, created_at, id); the review queue its partial index on status_changed_at.
@Injectable()
export class TypeOrmApplicationQueries implements ApplicationQueries {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async list(
    filter: ApplicationFilter,
    page: PageRequest,
  ): Promise<CursorPage<ApplicationSummaryDto>> {
    const query = this.summaries();
    if (filter.applicantId) {
      query.andWhere('application.applicant_id = :applicantId', {
        applicantId: filter.applicantId,
      });
    }
    if (filter.centerId) {
      query.andWhere('application.center_id = :centerId', { centerId: filter.centerId });
    }
    if (filter.status) {
      query.andWhere('application.status = :status', { status: filter.status });
    }
    const result = await paginateByCursor(query, page, {
      sortColumn: 'application.created_at',
      idColumn: 'application.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return { data: result.data.map(toSummary), nextCursor: result.nextCursor };
  }

  async reviewQueue(page: PageRequest): Promise<CursorPage<ApplicationSummaryDto>> {
    const query = this.summaries().andWhere(`application.status = 'needs_review'`);
    const result = await paginateByCursor(query, page, {
      sortColumn: 'application.status_changed_at',
      idColumn: 'application.id',
      direction: 'ASC',
      sortValueOf: (row) => row.statusChangedAt.toISOString(),
      idOf: (row) => row.id,
    });
    return { data: result.data.map(toSummary), nextCursor: result.nextCursor };
  }

  private summaries(): SelectQueryBuilder<FinancingApplicationOrmEntity> {
    return this.txHost.tx
      .getRepository(FinancingApplicationOrmEntity)
      .createQueryBuilder('application')
      .select([
        'application.id',
        'application.applicantId',
        'application.centerId',
        'application.programId',
        'application.programSnapshot',
        'application.product',
        'application.status',
        'application.score',
        'application.statusChangedAt',
        'application.createdAt',
      ]);
  }
}

function toSummary(row: FinancingApplicationOrmEntity): ApplicationSummaryDto {
  return {
    id: row.id,
    applicantId: row.applicantId,
    centerId: row.centerId,
    programId: row.programId,
    programName: row.programSnapshot.name,
    amountCents: row.programSnapshot.priceCents,
    product: row.product,
    status: row.status,
    score: row.score,
    statusChangedAt: row.statusChangedAt,
    createdAt: row.createdAt,
  };
}
