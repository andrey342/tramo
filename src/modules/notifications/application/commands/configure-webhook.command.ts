import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  WebhookSubscription,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { type ConfiguredWebhookDto } from '../dto/notifications.dto';
import { assertCanConfigure } from '../notifications-access';
import { toSubscriptionDto } from '../notifications.mapping';
import {
  CENTERS,
  type Centers,
  WEBHOOK_SECRETS,
  type WebhookSecrets,
} from '../ports/notifications-ports';

// A center's admin points its webhook at a URL. Each call issues a new secret, returned once:
// configuring the same URL again is how the secret is rotated.
export class ConfigureWebhookCommand extends Command<ConfiguredWebhookDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly url: string,
  ) {
    super();
  }
}

@CommandHandler(ConfigureWebhookCommand)
export class ConfigureWebhookHandler implements ICommandHandler<ConfigureWebhookCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: WebhookSubscriptionRepository,
    @Inject(CENTERS) private readonly centers: Centers,
    @Inject(WEBHOOK_SECRETS) private readonly secrets: WebhookSecrets,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ConfigureWebhookCommand): Promise<ConfiguredWebhookDto> {
    assertCanConfigure(command.actor, command.centerId);
    return this.uow.run(async () => {
      if (!(await this.centers.exists(command.centerId))) {
        throw new EntityNotFoundError('TrainingCenter', command.centerId);
      }
      const secret = this.secrets.generate();
      const now = this.clock.now();
      const existing = await this.subscriptions.findByCenter(command.centerId);
      const subscription =
        existing ??
        WebhookSubscription.subscribe({
          id: uuidv7(),
          centerId: command.centerId,
          url: command.url,
          secret,
          now,
        });
      if (existing) {
        existing.reconfigure(command.url, secret, now);
      }
      await this.subscriptions.save(subscription);
      return { ...toSubscriptionDto(subscription), secret };
    });
  }
}
