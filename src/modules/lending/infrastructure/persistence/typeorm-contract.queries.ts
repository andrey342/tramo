import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import { toBillablePlanDto } from '../../application/contract.mapping';
import {
  type ContractFilter,
  type ContractSummaryDto,
  type DisbursementDto,
  type DisbursementFilter,
} from '../../application/dto/contract.dto';
import { type BillablePlanDto } from '../../application/dto/plan-lookup';
import { type ContractQueries } from '../../application/ports/lending-ports';

import { FinancingPlanMapper } from './lending.mappers';
import {
  ContractOrmEntity,
  DisbursementOrmEntity,
  FinancingPlanOrmEntity,
} from './lending.orm-entities';

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

  // Served by ux_lending_financing_plans_contract_id (order and cursor) and the contract's primary
  // key for the join.
  async billablePlans(
    afterContractId: string | null,
    limit: number,
    contractId: string | null = null,
  ): Promise<readonly BillablePlanDto[]> {
    const query = this.txHost.tx
      .getRepository(FinancingPlanOrmEntity)
      .createQueryBuilder('plan')
      .innerJoin(ContractOrmEntity, 'contract', 'contract.id = plan.contract_id')
      .addSelect('contract.status', 'contract_status')
      .where(`plan.status = 'active'`)
      .andWhere(`contract.status IN ('active', 'in_arrears')`)
      // A payoff being collected covers what is left: nothing more is billed meanwhile.
      .andWhere(`COALESCE(plan.terms -> 'payoffRequest', 'null'::jsonb) = 'null'::jsonb`)
      .orderBy('plan.contract_id', 'ASC')
      .limit(limit);
    if (afterContractId) {
      query.andWhere('plan.contract_id > :afterContractId', { afterContractId });
    }
    if (contractId) {
      query.andWhere('plan.contract_id = :contractId', { contractId });
    }
    const { entities, raw } = await query.getRawAndEntities<{
      contract_status: 'active' | 'in_arrears';
    }>();
    return entities.map((row, index) =>
      toBillablePlanDto(FinancingPlanMapper.toDomain(row), raw[index]?.contract_status ?? 'active'),
    );
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
