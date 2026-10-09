import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { ClsService } from 'nestjs-cls';
import { uuidv7 } from 'uuidv7';

import { type EventBus } from '@shared/application';
import { type DomainEvent } from '@shared/domain';

import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';

export class EventPublishedOutsideUnitOfWorkError extends Error {
  constructor() {
    super('Domain events must be published inside a unit of work.');
    this.name = 'EventPublishedOutsideUnitOfWorkError';
  }
}

// Writes events to shared.outbox_messages in the caller's transaction. Delivery to subscribers
// happens later, from the worker (ADR 004). The row id is the event id consumers deduplicate on.
@Injectable()
export class OutboxEventBus implements EventBus {
  constructor(
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly cls: ClsService,
  ) {}

  async publish(events: readonly DomainEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }
    // Outside a transaction the state change and its events could be committed separately.
    if (!this.txHost.isTransactionActive()) {
      throw new EventPublishedOutsideUnitOfWorkError();
    }
    const id: unknown = this.cls.isActive() ? this.cls.getId() : undefined;
    const correlationId = typeof id === 'string' ? id : null;
    const rows = events.map((event) => {
      const row = new OutboxMessageOrmEntity();
      row.id = uuidv7();
      row.aggregateType = event.aggregateType;
      row.aggregateId = event.aggregateId;
      row.eventType = event.eventType;
      row.payload = event.payload;
      row.occurredAt = event.occurredAt;
      row.correlationId = correlationId;
      return row;
    });
    await this.txHost.tx.getRepository(OutboxMessageOrmEntity).insert(rows);
  }
}
