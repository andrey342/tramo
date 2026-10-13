import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { In, MoreThan } from 'typeorm';

import { type EventHistory, type IntegrationEvent } from '@shared/application';

import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

// The outbox is the event log: rows stay once published, in id (UUIDv7, time) order, served by the
// primary key. Read inside the caller's unit of work, so a rebuild sees one consistent history.
@Injectable()
export class OutboxEventHistory implements EventHistory {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async read(
    eventTypes: readonly string[],
    afterId: string | null,
    limit: number,
  ): Promise<readonly IntegrationEvent[]> {
    const rows = await this.txHost.tx.find(OutboxMessageOrmEntity, {
      where: {
        eventType: In([...eventTypes]),
        ...(afterId ? { id: MoreThan(afterId) } : {}),
      },
      order: { id: 'ASC' },
      take: limit,
    });
    return rows.map((row) => ({
      eventId: row.id,
      eventType: row.eventType,
      aggregateType: row.aggregateType,
      aggregateId: row.aggregateId,
      occurredAt: row.occurredAt.toISOString(),
      correlationId: row.correlationId,
      payload: row.payload as IntegrationEvent['payload'],
    }));
  }
}
