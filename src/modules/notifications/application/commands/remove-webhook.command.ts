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
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  WebhookNotConfiguredError,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { assertCanConfigure } from '../notifications-access';

// The center stops receiving events; deliveries still pending are given up when their job runs.
// Removing a removed webhook is done already; one never configured does not exist.
export class RemoveWebhookCommand extends Command<void> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
  ) {
    super();
  }
}

@CommandHandler(RemoveWebhookCommand)
export class RemoveWebhookHandler implements ICommandHandler<RemoveWebhookCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: WebhookSubscriptionRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RemoveWebhookCommand): Promise<void> {
    assertCanConfigure(command.actor, command.centerId);
    await this.uow.run(async () => {
      const subscription = await this.subscriptions.findByCenter(command.centerId);
      if (!subscription) {
        throw new WebhookNotConfiguredError(command.centerId);
      }
      const before = subscription.status;
      subscription.remove(this.clock.now());
      if (subscription.hasPendingEvents) {
        await this.subscriptions.save(subscription);
        this.audit.describeChanges({
          status: { before, after: subscription.status },
          url: { before: subscription.url, after: null },
        });
      }
    });
  }
}
