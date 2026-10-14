import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import {
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
  WebhookNotConfiguredError,
  type WebhookSubscriptionRepository,
} from '../../domain';
import { type WebhookSubscriptionDto } from '../dto/notifications.dto';
import { assertCanView } from '../notifications-access';
import { toSubscriptionDto } from '../notifications.mapping';
import { CENTERS, type Centers } from '../ports/notifications-ports';

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
    @Inject(CENTERS) private readonly centers: Centers,
  ) {}

  async execute(query: GetWebhookQuery): Promise<WebhookSubscriptionDto> {
    assertCanView(query.actor, query.centerId);
    // A center that does not exist is not one without a webhook.
    if (!(await this.centers.exists(query.centerId))) {
      throw new EntityNotFoundError('TrainingCenter', query.centerId);
    }
    const subscription = await this.subscriptions.findByCenter(query.centerId);
    if (!subscription?.active) {
      throw new WebhookNotConfiguredError(query.centerId);
    }
    return toSubscriptionDto(subscription);
  }
}
