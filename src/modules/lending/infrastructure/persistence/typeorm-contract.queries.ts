import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import {
  type ContractFilter,
  type ContractSummaryDto,
  type DisbursementDto,
  type DisbursementFilter,
} from '../../application/dto/contract.dto';
import { type ContractQueries } from '../../application/ports/lending-ports';

import { ContractOrmEntity, DisbursementOrmEntity } from './lending.orm-entities';

// Lists read only the columns they show and map rows straight to DTOs. Each scope has its index
// on (…, created_at, id).
@Injectable()
export class TypeOrmContractQueries implements ContractQueries {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async list(filter: ContractFilter, page: PageRequest): Promise<CursorPage<ContractSummaryDto>> {
    const query = this.txHost.tx
      .getRepository(ContractOrmEntity)
      .createQueryBuilder('contract')
      .select([
        'contract.id',
        'contract.applicationId',
        'contract.studentId',
        'contract.centerId',
        'contract.programName',
        'contract.principalCents',
        'contract.product',
        'contract.status',
        'contract.statusChangedAt',
        'contract.createdAt',
      ]);
    if (filter.studentId) {
      query.andWhere('contract.student_id = :studentId', { studentId: filter.studentId });
    }
    if (filter.centerId) {
      query.andWhere('contract.center_id = :centerId', { centerId: filter.centerId });
    }
    if (filter.status) {
      query.andWhere('contract.status = :status', { status: filter.status });
    }
    const result = await paginateByCursor(query, page, {
      sortColumn: 'contract.created_at',
      idColumn: 'contract.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return {
      data: result.data.map((row) => ({
        id: row.id,
        applicationId: row.applicationId,
        studentId: row.studentId,
        centerId: row.centerId,
        programName: row.programName,
        principalCents: row.principalCents,
        product: row.product,
        status: row.status,
        statusChangedAt: row.statusChangedAt,
        createdAt: row.createdAt,
      })),
      nextCursor: result.nextCursor,
    };
  }

  async listDisbursements(
    filter: DisbursementFilter,
    page: PageRequest,
  ): Promise<CursorPage<DisbursementDto>> {
    const query = this.txHost.tx
      .getRepository(DisbursementOrmEntity)
      .createQueryBuilder('disbursement')
      .select([
        'disbursement.id',
        'disbursement.contractId',
        'disbursement.centerId',
        'disbursement.amountCents',
        'disbursement.attempt',
        'disbursement.status',
        'disbursement.failureReason',
        'disbursement.statusChangedAt',
        'disbursement.settledAt',
        'disbursement.createdAt',
      ]);
    if (filter.status) {
      query.andWhere('disbursement.status = :status', { status: filter.status });
    }
    const result = await paginateByCursor(query, page, {
      sortColumn: 'disbursement.created_at',
      idColumn: 'disbursement.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return {
      data: result.data.map((row) => ({
        id: row.id,
        contractId: row.contractId,
        centerId: row.centerId,
        amountCents: row.amountCents,
        attempt: row.attempt,
        status: row.status,
        failureReason: row.failureReason,
        statusChangedAt: row.statusChangedAt,
        settledAt: row.settledAt,
        createdAt: row.createdAt,
      })),
      nextCursor: result.nextCursor,
    };
  }
}
