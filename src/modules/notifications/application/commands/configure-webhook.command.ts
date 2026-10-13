import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  InvalidWebhookUrlError,
  parseWebhookUrl,
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
  WEBHOOK_TARGETS,
  type WebhookSecrets,
  type WebhookTargets,
} from '../ports/notifications-ports';

// A center's admin points its webhook at a URL. Each call issues a new secret, returned once:
// configuring the same URL again is how the secret is rotated. A URL Tramo would not post to
// where it runs (http in production) is refused now, not on every delivery. The audit entry
// keeps the old and new URL, never the secret.
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
    @Inject(WEBHOOK_TARGETS) private readonly targets: WebhookTargets,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: ConfigureWebhookCommand): Promise<ConfiguredWebhookDto> {
    assertCanConfigure(command.actor, command.centerId);
    const refusal = this.targets.refusal(parseWebhookUrl(command.url));
    if (refusal) {
      throw new InvalidWebhookUrlError(refusal);
    }
    return this.uow.run(async () => {
      if (!(await this.centers.exists(command.centerId))) {
        throw new EntityNotFoundError('TrainingCenter', command.centerId);
      }
      const secret = this.secrets.generate();
      const now = this.clock.now();
      const existing = await this.subscriptions.findByCenter(command.centerId);
      const before = existing?.active ? existing.url : null;
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
      this.audit.describeChanges({
        url: { before, after: subscription.url },
        secret: { before: before === null ? null : 'replaced', after: 'issued' },
      });
      return { ...toSubscriptionDto(subscription), secret };
    });
  }
}
