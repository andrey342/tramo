import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { type CursorPage, type Principal } from '@shared/application';
import { Audited } from '@shared/infrastructure/audit';
import { ApiProblems, Idempotent } from '@shared/infrastructure/http';
import { Roles } from '@shared/infrastructure/http/access.decorators';
import { CurrentPrincipal } from '@shared/infrastructure/http/principal';

import { ConfigureWebhookCommand } from '../../application/commands/configure-webhook.command';
import { RedeliverWebhookCommand } from '../../application/commands/redeliver-webhook.command';
import { RemoveWebhookCommand } from '../../application/commands/remove-webhook.command';
import {
  type ConfiguredWebhookDto,
  type WebhookDeliveryDto,
  type WebhookSubscriptionDto,
} from '../../application/dto/notifications.dto';
import { GetWebhookQuery } from '../../application/queries/get-webhook.query';
import { ListWebhookDeliveriesQuery } from '../../application/queries/list-webhook-deliveries.query';

import {
  ConfiguredWebhookResponse,
  ConfigureWebhookRequest,
  DeliveryQueryDto,
  WebhookDeliveryPageResponse,
  WebhookDeliveryResponse,
  WebhookResponse,
} from './notifications.dto';

@ApiTags('webhooks')
@Controller('centers/:centerId')
export class WebhooksController {
  constructor(
    private readonly commands: CommandBus,
    private readonly queries: QueryBus,
  ) {}

  @Put('webhook')
  // The answer carries the signing secret: never kept by a cache.
  @Header('Cache-Control', 'no-store')
  @ApiProblems(400, 401, 403, 404, 409, 422)
  @ApiOkResponse({ type: ConfiguredWebhookResponse })
  @Roles('center_admin')
  @Audited({ action: 'webhook.configure', resource: 'center', resourceIdParam: 'centerId' })
  @ApiOperation({
    summary: "Point the center's webhook at a URL; returns a new signing secret, shown once",
  })
  configure(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Body() body: ConfigureWebhookRequest,
  ): Promise<ConfiguredWebhookDto> {
    return this.commands.execute(new ConfigureWebhookCommand(actor, centerId, body.url));
  }

  @Get('webhook')
  @ApiProblems(400, 401, 403, 404)
  @ApiOkResponse({ type: WebhookResponse })
  @Roles('center_admin', 'ops', 'admin')
  @ApiOperation({ summary: "The center's webhook, without its secret" })
  get(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ): Promise<WebhookSubscriptionDto> {
    return this.queries.execute(new GetWebhookQuery(actor, centerId));
  }

  @Delete('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiNoContentResponse()
  @Roles('center_admin')
  @Audited({ action: 'webhook.remove', resource: 'center', resourceIdParam: 'centerId' })
  @ApiOperation({ summary: 'Stop posting events to the center' })
  async remove(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
  ): Promise<void> {
    await this.commands.execute(new RemoveWebhookCommand(actor, centerId));
  }

  @Get('webhook-deliveries')
  @ApiProblems(400, 401, 403)
  @ApiOkResponse({ type: WebhookDeliveryPageResponse })
  @Roles('center_admin', 'ops', 'admin')
  @ApiOperation({ summary: 'What was posted to the center, newest first' })
  deliveries(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Query() query: DeliveryQueryDto,
  ): Promise<CursorPage<WebhookDeliveryDto>> {
    return this.queries.execute(
      new ListWebhookDeliveriesQuery(
        actor,
        centerId,
        { status: query.status, event: query.event },
        query.toPageRequest(),
      ),
    );
  }

  @Post('webhook-deliveries/:deliveryId/redeliver')
  @HttpCode(200)
  @ApiProblems(400, 401, 403, 404, 409)
  @ApiOkResponse({ type: WebhookDeliveryResponse })
  @Roles('center_admin', 'ops', 'admin')
  @Idempotent()
  @Audited({
    action: 'webhook.redeliver',
    resource: 'webhook_delivery',
    resourceIdParam: 'deliveryId',
  })
  @ApiOperation({ summary: 'Post a delivery again, as a new round of attempts' })
  redeliver(
    @CurrentPrincipal() actor: Principal,
    @Param('centerId', ParseUUIDPipe) centerId: string,
    @Param('deliveryId', ParseUUIDPipe) deliveryId: string,
  ): Promise<WebhookDeliveryDto> {
    return this.commands.execute(new RedeliverWebhookCommand(actor, centerId, deliveryId));
  }
}
