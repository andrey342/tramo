import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

import { type JsonValue } from '@shared/domain';
import { CursorPageQueryDto } from '@shared/infrastructure/http';

import {
  type DeliveryStatus,
  type SubscriptionStatus,
  WEBHOOK_EVENTS,
  type WebhookEvent,
} from '../../domain';

export class ConfigureWebhookRequest {
  @ApiProperty({
    example: 'https://center.example/tramo-webhooks',
    description:
      'Where Tramo posts the events; https outside development. Each call issues a new secret.',
  })
  @IsString()
  @MaxLength(2_000)
  url!: string;
}

export class WebhookResponse {
  @ApiProperty({ format: 'uuid' })
  centerId!: string;

  @ApiProperty({ example: 'https://center.example/tramo-webhooks' })
  url!: string;

  @ApiProperty({ enum: ['active', 'removed'] })
  status!: SubscriptionStatus;

  @ApiProperty({ enum: WEBHOOK_EVENTS, isArray: true, description: 'The events posted' })
  events!: readonly WebhookEvent[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  changedAt!: Date;
}

export class ConfiguredWebhookResponse extends WebhookResponse {
  @ApiProperty({
    example: 'whsec_3q2-7wEXAMPLEc0nUoT0QsN8m6x8u1z8p3Jr4k7m2v9yWQ',
    description:
      'HMAC-SHA256 key of the X-Tramo-Signature header (t=<unix>,v1=<hex of "<t>.<body>">). Shown only now; configure the webhook again to rotate it.',
  })
  secret!: string;
}

export class DeliveryQueryDto extends CursorPageQueryDto {
  @ApiPropertyOptional({ enum: ['pending', 'delivered', 'failed'] })
  @IsOptional()
  @IsIn(['pending', 'delivered', 'failed'])
  status?: DeliveryStatus;

  @ApiPropertyOptional({ enum: WEBHOOK_EVENTS })
  @IsOptional()
  @IsIn(WEBHOOK_EVENTS)
  event?: WebhookEvent;
}

export class WebhookDeliveryResponse {
  @ApiProperty({ format: 'uuid', description: 'Also sent as X-Tramo-Delivery-Id' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'The event: the "id" of the body posted' })
  eventId!: string;

  @ApiProperty({ enum: WEBHOOK_EVENTS })
  event!: WebhookEvent;

  @ApiProperty({ enum: ['pending', 'delivered', 'failed'] })
  status!: DeliveryStatus;

  @ApiProperty({ description: '1, then +1 for each redelivery' })
  round!: number;

  @ApiProperty({ description: 'Attempts made, over every round' })
  attempts!: number;

  @ApiProperty({ nullable: true, type: Number, example: 503 })
  lastStatusCode!: number | null;

  @ApiProperty({ nullable: true, type: String, example: 'HTTP 503' })
  lastError!: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, description: 'The "data" posted' })
  data!: Readonly<Record<string, JsonValue>>;

  @ApiProperty()
  occurredAt!: Date;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  deliveredAt!: Date | null;
}

export class WebhookDeliveryPageResponse {
  @ApiProperty({ type: [WebhookDeliveryResponse] })
  data!: readonly WebhookDeliveryResponse[];

  @ApiProperty({ nullable: true, type: String })
  nextCursor!: string | null;
}
