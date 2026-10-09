import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { EVENT_BUS, IDEMPOTENCY_STORE } from '@shared/application';

import { OutboxEventBus } from './outbox-event-bus';
import { OutboxMessageOrmEntity } from './outbox-message.orm-entity';
import { ProcessedEventsStore } from './processed-events.store';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OutboxMessageOrmEntity])],
  providers: [
    { provide: EVENT_BUS, useClass: OutboxEventBus },
    { provide: IDEMPOTENCY_STORE, useClass: ProcessedEventsStore },
  ],
  exports: [EVENT_BUS, IDEMPOTENCY_STORE, TypeOrmModule],
})
export class MessagingModule {}
