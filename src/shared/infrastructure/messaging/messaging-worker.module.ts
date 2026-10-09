import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';

import { QueueNames } from '../queues';

import { eventConsumerProcessorFor } from './event-consumer.processor';
import { EventSubscriptionRegistry } from './event-subscription.registry';
import { OutboxPublisher } from './outbox-publisher';

// Imported only by the worker: publishing the outbox and consuming events never runs in the api.
@Module({
  imports: [DiscoveryModule],
  providers: [
    EventSubscriptionRegistry,
    OutboxPublisher,
    ...QueueNames.EVENTS.map((queue) => eventConsumerProcessorFor(queue)),
  ],
  exports: [EventSubscriptionRegistry, OutboxPublisher],
})
export class MessagingWorkerModule {}
