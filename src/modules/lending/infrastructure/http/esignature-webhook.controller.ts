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
import { ApiHeader, ApiNoContentResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { type Request } from 'express';

import { CLOCK, type Clock } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { ApiProblems, ProblemException, verifyWebhook } from '@shared/infrastructure/http';
import { Public } from '@shared/infrastructure/http/access.decorators';

import {
  RecordSignatureEventCommand,
  type SignatureEvent,
} from '../../application/commands/record-signature-event.command';

import { ESignatureCallbackRequest } from './contracts.dto';

export const ESIGN_SIGNATURE_HEADER = 'x-esign-signature';

// Callbacks are authenticated by the provider's signature over the raw body, not by a user or a
// key. A guard runs before the body is validated, so nothing unsigned, tampered with or older
// than five minutes is even parsed into a command.
@Injectable()
export class ESignatureSignatureGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const verification = verifyWebhook(
      this.config.lending.esignWebhookSecret,
      request.header(ESIGN_SIGNATURE_HEADER),
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
export class ESignatureWebhookController {
  constructor(private readonly commands: CommandBus) {}

  @Post('esign')
  @Public()
  @UseGuards(ESignatureSignatureGuard)
  @HttpCode(204)
  @ApiHeader({
    name: ESIGN_SIGNATURE_HEADER,
    description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">',
    required: true,
  })
  @ApiProblems(400, 401, 404, 409, 422)
  @ApiNoContentResponse({ description: 'Recorded (or already recorded)' })
  @ApiOperation({ summary: 'An envelope was signed, declined or expired (the provider calls it)' })
  async callback(@Body() body: ESignatureCallbackRequest): Promise<void> {
    await this.commands.execute(new RecordSignatureEventCommand(toEvent(body)));
  }
}

function toEvent(body: ESignatureCallbackRequest): SignatureEvent {
  const occurredAt = new Date(body.occurredAt);
  if (body.type === 'envelope.completed') {
    return {
      type: 'signed',
      envelopeId: body.envelopeId,
      documentHash: body.documentHash ?? '',
      occurredAt,
    };
  }
  return {
    type: body.type === 'envelope.declined' ? 'declined' : 'expired',
    envelopeId: body.envelopeId,
    occurredAt,
  };
}
