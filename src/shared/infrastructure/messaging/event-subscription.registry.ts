import { Injectable, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService, Reflector } from '@nestjs/core';

import { type EventHandler, EVENT_SUBSCRIBER, type EventSubscription } from '@shared/application';

import { eventsQueueForConsumer } from '../queues';

export interface Subscriber extends EventSubscription {
  readonly queue: string;
}

// Built once at startup from providers decorated with @EventSubscriber. The outbox publisher asks
// it who listens to an event type; the consumer processors ask it which handler runs a delivery.
@Injectable()
export class EventSubscriptionRegistry implements OnModuleInit {
  private readonly byEvent = new Map<string, Subscriber[]>();
  private readonly handlers = new Map<string, EventHandler>();

  constructor(
    private readonly discovery: DiscoveryService,
    private readonly reflector: Reflector,
  ) {}

  onModuleInit(): void {
    for (const wrapper of this.discovery.getProviders()) {
      const metatype: unknown = wrapper.metatype;
      const instance: unknown = wrapper.instance;
      if (typeof metatype !== 'function' || !instance) {
        continue;
      }
      const subscription = this.reflector.get<EventSubscription | undefined>(
        EVENT_SUBSCRIBER,
        metatype,
      );
      if (subscription) {
        this.register(subscription, instance as EventHandler);
      }
    }
  }

  register(subscription: EventSubscription, handler: EventHandler): void {
    if (this.handlers.has(subscription.consumer)) {
      throw new Error(`Consumer "${subscription.consumer}" is registered twice.`);
    }
    this.handlers.set(subscription.consumer, handler);
    const subscriber = { ...subscription, queue: eventsQueueForConsumer(subscription.consumer) };
    this.byEvent.set(subscription.event, [
      ...(this.byEvent.get(subscription.event) ?? []),
      subscriber,
    ]);
  }

  subscribersOf(eventType: string): readonly Subscriber[] {
    return this.byEvent.get(eventType) ?? [];
  }

  handlerFor(consumer: string): EventHandler | undefined {
    return this.handlers.get(consumer);
  }
}
