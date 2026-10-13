import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, type JsonValue } from '@shared/domain';

import {
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookEvent,
  type WebhookSubscriptionRepository,
} from '../../domain';

export interface WebhookNotice {
  // The Tramo event reported: one delivery per center and event.
  readonly eventId: string;
  readonly centerId: string;
  readonly event: WebhookEvent;
  readonly occurredAt: Date;
  readonly data: Readonly<Record<string, JsonValue>>;
}

// Something a center is told about happened: a delivery is written down when the center has a
// webhook, and its job posts it. Returns whether one was.
export class PublishWebhookCommand extends Command<boolean> {
  constructor(readonly notice: WebhookNotice) {
    super();
  }
}

@CommandHandler(PublishWebhookCommand)
export class PublishWebhookHandler implements ICommandHandler<PublishWebhookCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: WebhookSubscriptionRepository,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: PublishWebhookCommand): Promise<boolean> {
    const { notice } = command;
    return this.uow.run(async () => {
      const subscription = await this.subscriptions.findByCenter(notice.centerId);
      if (!subscription?.active) {
        return false;
      }
      if (await this.deliveries.findByEvent(notice.centerId, notice.eventId)) {
        return false;
      }
      await this.deliveries.save(
        WebhookDelivery.request({ id: uuidv7(), ...notice, now: this.clock.now() }),
      );
      return true;
    });
  }
}
