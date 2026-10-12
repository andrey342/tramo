import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  Post,
  type RawBodyRequest,
  UseGuards,
} from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Request } from 'express';

import { CLOCK, type Clock } from '@shared/domain';
import { Audited } from '@shared/infrastructure/audit';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { ApiProblems, ProblemException, verifyWebhook } from '@shared/infrastructure/http';
import { Public } from '@shared/infrastructure/http/access.decorators';

import { RecordPaymentResultCommand } from '../../application/commands/record-payment-result.command';
import { PSP_SIGNATURE_HEADER } from '../adapters/simulated-psp-callbacks';

import { PaymentCallbackRequest, PaymentCallbackResponse } from './billing.dto';

// Callbacks are authenticated by the provider's signature over the raw body. The guard runs
// before the body is validated, so nothing unsigned, tampered with or older than five minutes
// reaches a command.
@Injectable()
export class PspSignatureGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const verification = verifyWebhook(
      this.config.billing.pspWebhookSecrets,
      request.header(PSP_SIGNATURE_HEADER),
      request.rawBody ?? Buffer.alloc(0),
      this.clock.now(),
    );
    if (!verification.valid) {
      throw new ProblemException(
        HttpStatus.UNAUTHORIZED,
        'invalid_webhook_signature',
        `The webhook signature is ${verification.reason}.`,
      );
    }
    return true;
  }
}

@ApiTags('webhooks')
@Controller('webhooks')
export class PspWebhookController {
  constructor(private readonly commands: CommandBus) {}

  @Post('psp')
  @Public()
  @UseGuards(PspSignatureGuard)
  @HttpCode(200)
  @ApiHeader({
    name: PSP_SIGNATURE_HEADER,
    description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">',
    required: true,
  })
  @ApiProblems(400, 401, 409, 422)
  @ApiOkResponse({ type: PaymentCallbackResponse, description: 'Recorded, or already recorded' })
  // A collection moves money: the callback leaves an audit entry, with its charge.
  @Audited({ action: 'billing.payment_callback', resource: 'charge' })
  @ApiOperation({ summary: 'A collection succeeded or failed (the payment provider calls it)' })
  callback(@Body() body: PaymentCallbackRequest): Promise<PaymentCallbackResponse> {
    return this.commands.execute(
      new RecordPaymentResultCommand({
        reference: body.reference,
        outcome: body.type === 'payment.succeeded' ? 'succeeded' : 'failed',
        failureReason: body.failureReason ?? null,
      }),
    );
  }
}
