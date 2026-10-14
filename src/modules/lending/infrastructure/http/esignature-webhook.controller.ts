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
import { ApiHeader, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { type Request } from 'express';

import { CLOCK, type Clock } from '@shared/domain';
import { Audited } from '@shared/infrastructure/audit';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import {
  ApiProblems,
  ProblemException,
  signatureFailure,
  verifyWebhook,
} from '@shared/infrastructure/http';
import { Public } from '@shared/infrastructure/http/access.decorators';

import {
  RecordSignatureEventCommand,
  type SignatureEvent,
} from '../../application/commands/record-signature-event.command';

import { ESignatureCallbackRequest } from './contracts.dto';

class SignatureCallbackResponse {
  @ApiProperty({ format: 'uuid', description: 'The contract the envelope belongs to' })
  id!: string;

  @ApiProperty({ example: 'signed' })
  status!: string;
}

export const ESIGN_SIGNATURE_HEADER = 'x-esign-signature';

// Callbacks are authenticated by the provider's signature over the raw body, not by a user or a
// key. The guard runs before the body is validated, so nothing unsigned, tampered with or older
// than five minutes reaches a command (Express has parsed the JSON by then, up to 100 kB).
@Injectable()
export class ESignatureSignatureGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const verification = verifyWebhook(
      this.config.lending.esignWebhookSecrets,
      request.header(ESIGN_SIGNATURE_HEADER),
      request.rawBody ?? Buffer.alloc(0),
      this.clock.now(),
    );
    if (!verification.valid) {
      throw new ProblemException(
        HttpStatus.UNAUTHORIZED,
        'invalid_webhook_signature',
        signatureFailure(verification.reason),
      );
    }
    return true;
  }
}

@ApiTags('webhooks')
// Not counted by the per-client rate limit: the provider sends every callback from a few
// addresses, a burst of them (a billing run, a batch of signatures) is legitimate, and each one
// is authenticated by its signature before anything else runs.
@SkipThrottle()
@Controller('webhooks')
export class ESignatureWebhookController {
  constructor(private readonly commands: CommandBus) {}

  @Post('esign')
  @Public()
  @UseGuards(ESignatureSignatureGuard)
  @HttpCode(200)
  @ApiHeader({
    name: ESIGN_SIGNATURE_HEADER,
    description: 't=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">',
    required: true,
  })
  @ApiProblems(400, 401, 409, 422)
  @ApiOkResponse({
    type: SignatureCallbackResponse,
    description:
      'Recorded; or the envelope was settled by an earlier callback, and the contract is as it was',
  })
  // Signing starts a payment: the callback leaves an audit entry, with its contract.
  @Audited({ action: 'contract.signature_callback', resource: 'contract' })
  @ApiOperation({ summary: 'An envelope was signed, declined or expired (the provider calls it)' })
  callback(@Body() body: ESignatureCallbackRequest): Promise<SignatureCallbackResponse> {
    return this.commands.execute(new RecordSignatureEventCommand(toEvent(body)));
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
