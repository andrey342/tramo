import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EVENT_BUS, EVENT_HISTORY, IDEMPOTENCY_STORE } from '@shared/application';

import { AggregatePersister } from '../database/aggregate-persister';

import { OutboxEventBus } from './outbox-event-bus';
import { OutboxEventHistory } from './outbox-event-history';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';
import { ProcessedEventsStore } from './processed-events.store';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxMessageOrmEntity])],
  providers: [
    { provide: EVENT_BUS, useClass: OutboxEventBus },
    { provide: EVENT_HISTORY, useClass: OutboxEventHistory },
    { provide: IDEMPOTENCY_STORE, useClass: ProcessedEventsStore },
    AggregatePersister,
  ],
  exports: [EVENT_BUS, EVENT_HISTORY, IDEMPOTENCY_STORE, AggregatePersister, TypeOrmModule],
})
export class MessagingModule {}
