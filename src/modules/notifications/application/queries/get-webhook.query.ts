import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';

import {
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  WebhookNotConfiguredError,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { type WebhookSubscriptionDto } from '../dto/notifications.dto';
import { assertCanView } from '../notifications-access';
import { toSubscriptionDto } from '../notifications.mapping';

// The center's webhook as configured, without its secret.
export class GetWebhookQuery extends Query<WebhookSubscriptionDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
  ) {
    super();
  }
}

@QueryHandler(GetWebhookQuery)
export class GetWebhookHandler implements IQueryHandler<GetWebhookQuery> {
  constructor(
    @Inject(WEBHOOK_SUBSCRIPTION_REPOSITORY)
    private readonly subscriptions: WebhookSubscriptionRepository,
  ) {}

  async execute(query: GetWebhookQuery): Promise<WebhookSubscriptionDto> {
    assertCanView(query.actor, query.centerId);
    const subscription = await this.subscriptions.findByCenter(query.centerId);
    if (!subscription?.active) {
      throw new WebhookNotConfiguredError(query.centerId);
    }
    return toSubscriptionDto(subscription);
  }
}
