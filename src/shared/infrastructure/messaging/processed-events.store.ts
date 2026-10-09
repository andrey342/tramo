import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type IdempotencyStore } from '@shared/application';

// A row per (event, consumer). The primary key makes concurrent claims safe: exactly one insert
// wins, the other sees zero affected rows.
@Injectable()
export class ProcessedEventsStore implements IdempotencyStore {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async claim(key: string, consumer: string): Promise<boolean> {
    const rows: unknown[] = await this.txHost.tx.query(
      `INSERT INTO shared.processed_events (event_id, consumer)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING
       RETURNING event_id`,
      [key, consumer],
    );
    return rows.length === 1;
  }
}
