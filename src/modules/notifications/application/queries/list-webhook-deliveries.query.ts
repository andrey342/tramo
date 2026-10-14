import { Inject } from '@nestjs/common';
import { type IQueryHandler, Query, QueryHandler } from '@nestjs/cqrs';

import { type CursorPage, type PageRequest, type Principal } from '@shared/application';
import { EntityNotFoundError } from '@shared/domain';

import { type WebhookDeliveryDto } from '../dto/notifications.dto';
import { assertCanView } from '../notifications-access';
import {
  CENTERS,
  type Centers,
  type DeliveryFilter,
  NOTIFICATIONS_QUERIES,
  type NotificationsQueries,
} from '../ports/notifications-ports';

// What was delivered to a center's webhook, newest first.
export class ListWebhookDeliveriesQuery extends Query<CursorPage<WebhookDeliveryDto>> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly filter: DeliveryFilter,
    readonly page: PageRequest,
  ) {
    super();
  }
}

@QueryHandler(ListWebhookDeliveriesQuery)
export class ListWebhookDeliveriesHandler implements IQueryHandler<ListWebhookDeliveriesQuery> {
  constructor(
    @Inject(NOTIFICATIONS_QUERIES) private readonly queries: NotificationsQueries,
    @Inject(CENTERS) private readonly centers: Centers,
  ) {}

  async execute(query: ListWebhookDeliveriesQuery): Promise<CursorPage<WebhookDeliveryDto>> {
    assertCanView(query.actor, query.centerId);
    if (!(await this.centers.exists(query.centerId))) {
      throw new EntityNotFoundError('TrainingCenter', query.centerId);
    }
    return this.queries.listDeliveries(query.centerId, query.filter, query.page);
  }
}
