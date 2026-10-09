import { Processor } from '@nestjs/bullmq';
import { Inject, type Type } from '@nestjs/common';
import { type Job, UnrecoverableError } from 'bullmq';

import {
  IDEMPOTENCY_STORE,
  type IdempotencyStore,
  type IntegrationEvent,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';

import { QueueProcessor } from '../queues';

import { EventSubscriptionRegistry } from './event-subscription.registry';

// Delivery is at least once (outbox republish after a crash, BullMQ retries). The claim and the
// handler's effects share one transaction, so the effects happen exactly once.
export abstract class EventConsumerProcessor extends QueueProcessor<IntegrationEvent> {
  @Inject(EventSubscriptionRegistry) private readonly registry!: EventSubscriptionRegistry;
  @Inject(UNIT_OF_WORK) private readonly uow!: UnitOfWork;
  @Inject(IDEMPOTENCY_STORE) private readonly idempotency!: IdempotencyStore;

  protected async handle(job: Job<IntegrationEvent>): Promise<void> {
    const consumer = job.name;
    const handler = this.registry.handlerFor(consumer);
    if (!handler) {
      throw new UnrecoverableError(`No subscriber is registered as "${consumer}".`);
    }
    await this.uow.run(async () => {
      if (!(await this.idempotency.claim(job.data.eventId, consumer))) {
        this.logger.debug({ consumer, eventId: job.data.eventId }, 'Event already processed');
        return;
      }
      await handler.handle(job.data);
    });
  }
}

const CONCURRENCY = 5;

export function eventConsumerProcessorFor(queue: string): Type<EventConsumerProcessor> {
  @Processor(queue, { concurrency: CONCURRENCY })
  class QueueEventConsumer extends EventConsumerProcessor {}
  Object.defineProperty(QueueEventConsumer, 'name', { value: `EventConsumer[${queue}]` });
  return QueueEventConsumer;
}
