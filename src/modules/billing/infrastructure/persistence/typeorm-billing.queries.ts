import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { uuidv7 } from 'uuidv7';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import { toChargeDto } from '../../application/billing.mapping';
import {
  type ChargeDto,
  type LedgerEntryDto,
  type LedgerEntryType,
} from '../../application/dto/billing.dto';
import {
  type BillingQueries,
  type DeclarationReminders,
} from '../../application/ports/billing-ports';

import { ChargeMapper } from './billing.mappers';
import { ChargeOrmEntity, LedgerEntryOrmEntity } from './billing.orm-entities';

// A contract's charges newest first (ix_billing_charges_contract_id_created_at_id) and its ledger
// in order (ix_billing_ledger_entries_contract_id_occurred_at_id).
@Injectable()
export class TypeOrmBillingQueries implements BillingQueries {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async listCharges(contractId: string, page: PageRequest): Promise<CursorPage<ChargeDto>> {
    const query = this.txHost.tx
      .getRepository(ChargeOrmEntity)
      .createQueryBuilder('charge')
      .where('charge.contract_id = :contractId', { contractId });
    const result = await paginateByCursor(query, page, {
      sortColumn: 'charge.created_at',
      idColumn: 'charge.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return {
      data: result.data.map((row) => toChargeDto(ChargeMapper.toDomain(row))),
      nextCursor: result.nextCursor,
    };
  }

  async ledger(contractId: string): Promise<readonly Omit<LedgerEntryDto, 'balanceCents'>[]> {
    const rows = await this.txHost.tx.find(LedgerEntryOrmEntity, {
      where: { contractId },
      order: { occurredAt: 'ASC', id: 'ASC' },
    });
    return rows.map((row) => ({
      occurredAt: row.occurredAt,
      type: row.type,
      chargeId: row.chargeId,
      description: row.description,
      amountCents: row.amountCents,
    }));
  }
}

@Injectable()
export class TypeOrmDeclarationReminders implements DeclarationReminders {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async record(contractId: string, period: string): Promise<boolean> {
    const inserted = await this.txHost.tx.query<unknown[]>(
      `INSERT INTO billing.declaration_reminders (contract_id, period, sent_at)
       VALUES ($1, $2, now())
       ON CONFLICT ON CONSTRAINT pk_billing_declaration_reminders DO NOTHING
       RETURNING contract_id`,
      [contractId, period],
    );
    return inserted.length > 0;
  }
}

export interface LedgerLine {
  readonly eventId: string;
  readonly contractId: string;
  readonly chargeId: string;
  readonly type: LedgerEntryType;
  readonly amountCents: number;
  readonly description: string;
  readonly occurredAt: Date;
}

// Writes the ledger projection; one line per event, whatever the redeliveries.
@Injectable()
export class LedgerWriter {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async append(line: LedgerLine): Promise<void> {
    await this.txHost.tx
      .createQueryBuilder()
      .insert()
      .into(LedgerEntryOrmEntity)
      .values({ id: uuidv7(), ...line })
      .orIgnore()
      .execute();
  }
}
