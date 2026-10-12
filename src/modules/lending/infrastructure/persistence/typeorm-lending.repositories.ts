import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import {
  AggregatePersister,
  isUniqueViolation,
} from '@shared/infrastructure/database/aggregate-persister';

import {
  type Contract,
  type ContractRepository,
  type Disbursement,
  type DisbursementRepository,
  type FinancingPlan,
  type FinancingPlanRepository,
  LendingRecordExistsError,
} from '../../domain';

import { ContractMapper, DisbursementMapper, FinancingPlanMapper } from './lending.mappers';
import {
  ContractOrmEntity,
  DisbursementOrmEntity,
  FinancingPlanOrmEntity,
} from './lending.orm-entities';

@Injectable()
export class TypeOrmContractRepository implements ContractRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<Contract | null> {
    const row = await this.txHost.tx.findOneBy(ContractOrmEntity, { id });
    return row ? ContractMapper.toDomain(row) : null;
  }

  async findByApplicationId(applicationId: string): Promise<Contract | null> {
    const row = await this.txHost.tx.findOneBy(ContractOrmEntity, { applicationId });
    return row ? ContractMapper.toDomain(row) : null;
  }

  async findByEnvelopeId(envelopeId: string): Promise<Contract | null> {
    const row = await this.txHost.tx.findOneBy(ContractOrmEntity, { envelopeId });
    return row ? ContractMapper.toDomain(row) : null;
  }

  async save(contract: Contract): Promise<void> {
    try {
      await this.persister.save(
        ContractOrmEntity,
        contract,
        ContractMapper.toRow(contract),
        'Contract',
      );
    } catch (error) {
      if (isUniqueViolation(error, 'ux_lending_contracts_application_id')) {
        throw new LendingRecordExistsError('Contract', 'application', contract.applicationId);
      }
      throw error;
    }
  }
}

@Injectable()
export class TypeOrmDisbursementRepository implements DisbursementRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
    private readonly mapper: DisbursementMapper,
  ) {}

  async findById(id: string): Promise<Disbursement | null> {
    const row = await this.txHost.tx.findOneBy(DisbursementOrmEntity, { id });
    return row ? this.mapper.toDomain(row) : null;
  }

  async findByContractId(contractId: string): Promise<Disbursement | null> {
    const row = await this.txHost.tx.findOneBy(DisbursementOrmEntity, { contractId });
    return row ? this.mapper.toDomain(row) : null;
  }

  async save(disbursement: Disbursement): Promise<void> {
    try {
      await this.persister.save(
        DisbursementOrmEntity,
        disbursement,
        this.mapper.toRow(disbursement),
        'Disbursement',
      );
    } catch (error) {
      if (isUniqueViolation(error, 'ux_lending_disbursements_contract_id')) {
        throw new LendingRecordExistsError('Disbursement', 'contract', disbursement.contractId);
      }
      throw error;
    }
  }
}

@Injectable()
export class TypeOrmFinancingPlanRepository implements FinancingPlanRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<FinancingPlan | null> {
    const row = await this.txHost.tx.findOneBy(FinancingPlanOrmEntity, { id });
    return row ? FinancingPlanMapper.toDomain(row) : null;
  }

  async findByContractId(contractId: string): Promise<FinancingPlan | null> {
    const row = await this.txHost.tx.findOneBy(FinancingPlanOrmEntity, { contractId });
    return row ? FinancingPlanMapper.toDomain(row) : null;
  }

  async save(plan: FinancingPlan): Promise<void> {
    try {
      await this.persister.save(
        FinancingPlanOrmEntity,
        plan,
        FinancingPlanMapper.toRow(plan),
        'FinancingPlan',
      );
    } catch (error) {
      if (isUniqueViolation(error, 'ux_lending_financing_plans_contract_id')) {
        throw new LendingRecordExistsError('FinancingPlan', 'contract', plan.contractId);
      }
      throw error;
    }
  }
}
