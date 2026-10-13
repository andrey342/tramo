import { Injectable } from '@nestjs/common';
import { TransactionHost } from '@nestjs-cls/transactional';
import { type TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';

import { type CursorPage, type PageRequest } from '@shared/application';
import { paginateByCursor } from '@shared/infrastructure/database';

import { type WebhookDeliveryDto } from '../../application/dto/notifications.dto';
import { toDeliveryDto } from '../../application/notifications.mapping';
import {
  type DeliveryFilter,
  type NotificationsQueries,
} from '../../application/ports/notifications-ports';

import { WebhookDeliveryMapper } from './notifications.mappers';
import { WebhookDeliveryOrmEntity } from './notifications.orm-entities';

// A center's deliveries newest first (ix_notifications_webhook_deliveries_center_id_created_at_id).
@Injectable()
export class TypeOrmNotificationsQueries implements NotificationsQueries {
  constructor(private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>) {}

  async listDeliveries(
    centerId: string,
    filter: DeliveryFilter,
    page: PageRequest,
  ): Promise<CursorPage<WebhookDeliveryDto>> {
    const query = this.txHost.tx
      .getRepository(WebhookDeliveryOrmEntity)
      .createQueryBuilder('delivery')
      .where('delivery.center_id = :centerId', { centerId });
    if (filter.status) {
      query.andWhere('delivery.status = :status', { status: filter.status });
    }
    if (filter.event) {
      query.andWhere('delivery.event = :event', { event: filter.event });
    }
    const result = await paginateByCursor(query, page, {
      sortColumn: 'delivery.created_at',
      idColumn: 'delivery.id',
      sortValueOf: (row) => row.createdAt.toISOString(),
      idOf: (row) => row.id,
    });
    return {
      data: result.data.map((row) => toDeliveryDto(WebhookDeliveryMapper.toDomain(row))),
      nextCursor: result.nextCursor,
    };
  }
}
