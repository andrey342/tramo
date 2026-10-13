import { type JsonValue } from '@shared/domain';

import { type DeliveryStatus, type SubscriptionStatus, type WebhookEvent } from '../../domain';

export interface WebhookSubscriptionDto {
  readonly centerId: string;
  readonly url: string;
  readonly status: SubscriptionStatus;
  readonly events: readonly WebhookEvent[];
  readonly createdAt: Date;
  readonly changedAt: Date;
}

// Returned once, when the webhook is configured: the only time the secret leaves Tramo.
export interface ConfiguredWebhookDto extends WebhookSubscriptionDto {
  readonly secret: string;
}

export interface WebhookDeliveryDto {
  readonly id: string;
  readonly eventId: string;
  readonly event: WebhookEvent;
  readonly status: DeliveryStatus;
  readonly round: number;
  readonly attempts: number;
  readonly lastStatusCode: number | null;
  readonly lastError: string | null;
  readonly data: Readonly<Record<string, JsonValue>>;
  readonly occurredAt: Date;
  readonly createdAt: Date;
  readonly deliveredAt: Date | null;
}
