import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, LessThanOrEqual, MoreThan, Not } from 'typeorm';

import { type CalendarDate, ConcurrentModificationError } from '@shared/domain';
import {
  AggregatePersister,
  isUniqueViolation,
} from '@shared/infrastructure/database/aggregate-persister';

import {
  type Charge,
  type ChargeRepository,
  ConcurrentChargeError,
  ARREARS_STEP,
  type IncomeDeclaration,
  IncomeAlreadyDeclaredError,
  type IncomeDeclarationRepository,
  type PaymentMandate,
  type PaymentMandateRepository,
} from '../../domain';

import { ChargeMapper, IncomeDeclarationMapper, PaymentMandateMapper } from './billing.mappers';
import {
  ChargeOrmEntity,
  IncomeDeclarationOrmEntity,
  PaymentMandateOrmEntity,
} from './billing.orm-entities';

const SETTLED = ['paid', 'written_off', 'cancelled'] as const;

@Injectable()
export class TypeOrmChargeRepository implements ChargeRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findById(id: string): Promise<Charge | null> {
    const row = await this.txHost.tx.findOneBy(ChargeOrmEntity, { id });
    return row ? ChargeMapper.toDomain(row) : null;
  }

  async findByReference(contractId: string, reference: string): Promise<Charge | null> {
    const row = await this.txHost.tx.findOneBy(ChargeOrmEntity, { contractId, reference });
    return row ? ChargeMapper.toDomain(row) : null;
  }

  // Served by ix_billing_charges_scheduled_id.
  async findDueIds(
    asOf: CalendarDate,
    limit: number,
    afterId: string | null,
    contractId: string | null = null,
  ): Promise<string[]> {
    const rows = await this.txHost.tx.find(ChargeOrmEntity, {
      select: { id: true },
      where: {
        status: 'scheduled',
        dueDate: LessThanOrEqual(asOf.toString()),
        ...(afterId ? { id: MoreThan(afterId) } : {}),
        ...(contractId ? { contractId } : {}),
      },
      order: { id: 'ASC' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  // Served by ix_billing_charges_unsettled.
  async findUnsettledIds(
    limit: number,
    afterId: string | null,
    contractId: string | null = null,
  ): Promise<string[]> {
    const rows = await this.txHost.tx.find(ChargeOrmEntity, {
      select: { id: true },
      where: {
        status: Not(In([...SETTLED])),
        ...(afterId ? { id: MoreThan(afterId) } : {}),
        ...(contractId ? { contractId } : {}),
      },
      order: { id: 'ASC' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  async findOpen(contractId: string): Promise<Charge[]> {
    const rows = await this.txHost.tx.find(ChargeOrmEntity, {
      where: { contractId, status: In(['scheduled', 'failed', 'overdue']) },
      order: { id: 'ASC' },
    });
    return rows.map((row) => ChargeMapper.toDomain(row));
  }

  async hasOtherChargesInArrears(contractId: string, exceptChargeId: string): Promise<boolean> {
    return this.txHost.tx.exists(ChargeOrmEntity, {
      where: {
        contractId,
        id: Not(exceptChargeId),
        status: Not(In([...SETTLED])),
        // Charge.inArrears: past the arrears step of dunning.
        dunningStep: MoreThan(ARREARS_STEP),
      },
    });
  }

  async hasPayoff(contractId: string): Promise<boolean> {
    return this.txHost.tx.exists(ChargeOrmEntity, {
      where: { contractId, kind: 'payoff', status: In(['scheduled', 'pending', 'paid']) },
    });
  }

  // A transaction-scoped advisory lock on the contract id, released at commit or rollback.
  async lockContract(contractId: string): Promise<void> {
    await this.txHost.tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
      `billing.contract:${contractId}`,
    ]);
  }

  async save(charge: Charge): Promise<void> {
    try {
      await this.persister.save(ChargeOrmEntity, charge, ChargeMapper.toRow(charge), 'Charge');
    } catch (error) {
      if (isUniqueViolation(error, 'ux_billing_charges_contract_id_reference')) {
        throw new ConcurrentChargeError(charge.reference);
      }
      throw error;
    }
  }
}

@Injectable()
export class TypeOrmPaymentMandateRepository implements PaymentMandateRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
    private readonly mapper: PaymentMandateMapper,
  ) {}

  async findById(id: string): Promise<PaymentMandate | null> {
    const row = await this.txHost.tx.findOneBy(PaymentMandateOrmEntity, { id });
    return row ? this.mapper.toDomain(row) : null;
  }

  async findActiveByContract(contractId: string): Promise<PaymentMandate | null> {
    const row = await this.txHost.tx.findOneBy(PaymentMandateOrmEntity, {
      contractId,
      status: 'active',
    });
    return row ? this.mapper.toDomain(row) : null;
  }

  // Two mandates signed at once for one contract: the second finds the first in force.
  async save(mandate: PaymentMandate): Promise<void> {
    try {
      await this.persister.save(
        PaymentMandateOrmEntity,
        mandate,
        this.mapper.toRow(mandate),
        'PaymentMandate',
      );
    } catch (error) {
      if (isUniqueViolation(error, 'ux_billing_payment_mandates_active_contract_id')) {
        throw new ConcurrentModificationError('PaymentMandate', mandate.id);
      }
      throw error;
    }
  }
}

@Injectable()
export class TypeOrmIncomeDeclarationRepository implements IncomeDeclarationRepository {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly persister: AggregatePersister,
  ) {}

  async findByPeriod(contractId: string, period: string): Promise<IncomeDeclaration | null> {
    const row = await this.txHost.tx.findOneBy(IncomeDeclarationOrmEntity, { contractId, period });
    return row ? IncomeDeclarationMapper.toDomain(row) : null;
  }

  async save(declaration: IncomeDeclaration): Promise<void> {
    try {
      await this.persister.save(
        IncomeDeclarationOrmEntity,
        declaration,
        IncomeDeclarationMapper.toRow(declaration),
        'IncomeDeclaration',
      );
    } catch (error) {
      if (isUniqueViolation(error, 'ux_billing_income_declarations_contract_id_period')) {
        throw new IncomeAlreadyDeclaredError(declaration.period);
      }
      throw error;
    }
  }
}
