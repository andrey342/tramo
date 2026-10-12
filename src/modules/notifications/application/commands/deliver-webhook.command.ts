import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { WEBHOOK_SENDER, type WebhookSender } from '../ports/notifications-ports';

export type DeliveryOutcome = 'delivered' | 'skipped' | 'cancelled';

// The attempt failed and the job is to retry it (or, on its last attempt, the round is over).
export class WebhookAttemptFailedError extends Error {
  constructor(
    readonly deliveryId: string,
    readonly reason: string,
  ) {
    super(`Webhook delivery ${deliveryId} failed: ${reason}`);
    this.name = 'WebhookAttemptFailedError';
  }
}

// One attempt of a round of a delivery, made by its job: the body is the event as the center
// receives it, signed with the center's current secret. A 2xx delivers it; anything else is
// recorded and thrown, so the job retries with backoff, and the last attempt ends the round.
export class DeliverWebhookCommand extends Command<DeliveryOutcome> {
  constructor(
    readonly deliveryId: string,
    readonly round: number,
    readonly lastAttempt: boolean,
  ) {
    super();
  }
}

@CommandHandler(DeliverWebhookCommand)
export class DeliverWebhookHandler implements ICommandHandler<DeliverWebhookCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: WebhookSubscriptionRepository,
    @Inject(WEBHOOK_SENDER) private readonly sender: WebhookSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: DeliverWebhookCommand): Promise<DeliveryOutcome> {
    const { round } = command;
    const target = await this.uow.run(async () => {
      const delivery = await this.deliveries.findById(command.deliveryId);
      if (!delivery?.awaits(round)) {
        return null;
      }
      const subscription = await this.subscriptions.findByCenter(delivery.centerId);
      if (!subscription?.active) {
        delivery.cancel(this.clock.now());
        await this.deliveries.save(delivery);
        return 'cancelled' as const;
      }
      return { delivery, url: subscription.url, secret: subscription.secret };
    });
    if (target === null) {
      return 'skipped';
    }
    if (target === 'cancelled') {
      return 'cancelled';
    }
    // The call happens outside any transaction: a slow endpoint holds no connection.
    const { delivery } = target;
    let statusCode: number | null = null;
    let error: string | null = null;
    try {
      ({ statusCode } = await this.sender.post({
        url: target.url,
        secret: target.secret,
        deliveryId: delivery.id,
        event: delivery.event,
        body: body(delivery),
      }));
      if (statusCode < 200 || statusCode >= 300) {
        error = `HTTP ${String(statusCode)}`;
      }
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    await this.record(command, statusCode, error);
    if (error !== null) {
      throw new WebhookAttemptFailedError(delivery.id, error);
    }
    return 'delivered';
  }

  private async record(
    command: DeliverWebhookCommand,
    statusCode: number | null,
    error: string | null,
  ): Promise<void> {
    await this.uow.run(async () => {
      const delivery = await this.deliveries.findById(command.deliveryId);
      if (!delivery) {
        return;
      }
      const now = this.clock.now();
      if (error === null && statusCode !== null) {
        delivery.recordDelivered(command.round, statusCode, now);
      } else {
        delivery.recordFailedAttempt(command.round, statusCode, error ?? 'unknown', now);
        if (command.lastAttempt) {
          delivery.giveUp(command.round, now);
        }
      }
      await this.deliveries.save(delivery);
    });
  }
}

// What the center receives: the event, its time and its data; the delivery id and the event name
// also go in headers.
function body(delivery: WebhookDelivery): string {
  return JSON.stringify({
    id: delivery.eventId,
    event: delivery.event,
    occurredAt: delivery.occurredAt.toISOString(),
    data: delivery.data,
  });
}
