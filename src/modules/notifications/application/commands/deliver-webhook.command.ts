import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  type AttemptOutcome,
  type AttemptResult,
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  type WebhookDelivery,
  type WebhookDeliveryRepository,
  type WebhookSubscriptionRepository,
} from '../../domain';
import {
  WEBHOOK_SENDER,
  WebhookPostFailedError,
  type WebhookSender,
} from '../ports/notifications-ports';

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
// receives it, signed with the center's current secret (and, for a day after a rotation, the one
// it replaced as well: WebhookSubscription.signingSecrets). The delivery decides what the answer
// means (WebhookDelivery.recordAttempt); a failed attempt is thrown so the job retries it with
// backoff. When the job's last attempt fails before anything was recorded (the database, the
// secret), the round is closed anyway, so the delivery can be redelivered.
export class DeliverWebhookCommand extends Command<AttemptOutcome | 'cancelled'> {
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

  async execute(command: DeliverWebhookCommand): Promise<AttemptOutcome | 'cancelled'> {
    let outcome: AttemptOutcome | 'cancelled';
    try {
      outcome = await this.attempt(command);
    } catch (error) {
      if (command.lastAttempt && !(error instanceof WebhookAttemptFailedError)) {
        await this.closeRound(command).catch(() => undefined);
      }
      throw error;
    }
    return outcome;
  }

  private async attempt(command: DeliverWebhookCommand): Promise<AttemptOutcome | 'cancelled'> {
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
      return {
        delivery,
        url: subscription.url,
        secrets: subscription.signingSecrets(this.clock.now()),
      };
    });
    if (target === null) {
      return 'ignored';
    }
    if (target === 'cancelled') {
      return 'cancelled';
    }
    // The call happens outside any transaction: a slow endpoint holds no connection.
    const { delivery } = target;
    let result: AttemptResult;
    try {
      const { statusCode } = await this.sender.post({
        url: target.url,
        secrets: target.secrets,
        deliveryId: delivery.id,
        event: delivery.event,
        body: body(delivery),
      });
      result = { statusCode };
    } catch (cause) {
      result = {
        statusCode: null,
        error: cause instanceof WebhookPostFailedError ? cause.code : 'network_failed',
      };
    }
    const outcome = await this.uow.run(async () => {
      const current = await this.deliveries.findById(command.deliveryId);
      if (!current) {
        return 'ignored';
      }
      const recorded = current.recordAttempt(round, result, command.lastAttempt, this.clock.now());
      await this.deliveries.save(current);
      return recorded;
    });
    if (outcome === 'retry' || outcome === 'failed') {
      throw new WebhookAttemptFailedError(
        delivery.id,
        result.statusCode === null ? result.error : `http_${String(result.statusCode)}`,
      );
    }
    return outcome;
  }

  private async closeRound(command: DeliverWebhookCommand): Promise<void> {
    await this.uow.run(async () => {
      const delivery = await this.deliveries.findById(command.deliveryId);
      if (delivery) {
        delivery.giveUp(command.round, 'internal_error', this.clock.now());
        await this.deliveries.save(delivery);
      }
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
