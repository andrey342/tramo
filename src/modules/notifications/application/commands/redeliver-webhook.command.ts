import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  WebhookDeliveryNotFoundError,
  type WebhookDeliveryRepository,
  WebhookNotConfiguredError,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { type WebhookDeliveryDto } from '../dto/notifications.dto';
import { assertCanView } from '../notifications-access';
import { toDeliveryDto } from '../notifications.mapping';

// The center (its endpoint was down, or it lost what it received) or ops ask for a delivery
// again: a new round of attempts, to the URL configured now.
export class RedeliverWebhookCommand extends Command<WebhookDeliveryDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly deliveryId: string,
  ) {
    super();
  }
}

@CommandHandler(RedeliverWebhookCommand)
export class RedeliverWebhookHandler implements ICommandHandler<RedeliverWebhookCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WEBHOOK_DELIVERY_REPOSITORY) private readonly deliveries: WebhookDeliveryRepository,
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: WebhookSubscriptionRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RedeliverWebhookCommand): Promise<WebhookDeliveryDto> {
    assertCanView(command.actor, command.centerId);
    return this.uow.run(async () => {
      const delivery = await this.deliveries.findById(command.deliveryId);
      // Another center's delivery does not exist, as far as this one is concerned.
      if (delivery?.centerId !== command.centerId) {
        throw new WebhookDeliveryNotFoundError(command.deliveryId);
      }
      if (!(await this.subscriptions.findByCenter(command.centerId))?.active) {
        throw new WebhookNotConfiguredError(command.centerId);
      }
      const before = { status: delivery.status, round: delivery.round };
      delivery.redeliver(this.clock.now());
      await this.deliveries.save(delivery);
      this.audit.describeChanges({
        status: { before: before.status, after: delivery.status },
        round: { before: before.round, after: delivery.round },
      });
      return toDeliveryDto(delivery);
    });
  }
}
