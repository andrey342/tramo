import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { type ApiKeyScope, CLOCK, type Clock } from '@shared/domain';

import { API_KEY_REPOSITORY, ApiKey, type ApiKeyRepository } from '../../domain';
import { actorId, assertCanManageCenter } from '../center-access';
import { type IssuedApiKeyDto } from '../dto/api-key.dto';
import { CREDENTIAL_GENERATOR, type CredentialGenerator } from '../ports/iam-ports';

import { toApiKeySummary } from './api-key.mapping';

export class IssueApiKeyCommand extends Command<IssuedApiKeyDto> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly name: string,
    readonly scopes: readonly ApiKeyScope[],
  ) {
    super();
  }
}

@CommandHandler(IssueApiKeyCommand)
export class IssueApiKeyHandler implements ICommandHandler<IssueApiKeyCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CREDENTIAL_GENERATOR) private readonly credentials: CredentialGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: IssueApiKeyCommand): Promise<IssuedApiKeyDto> {
    assertCanManageCenter(command.actor, command.centerId);
    const secret = this.credentials.apiKey();
    const apiKey = ApiKey.issue({
      id: uuidv7(),
      centerId: command.centerId,
      name: command.name,
      prefix: secret.prefix,
      secretHash: secret.hash,
      scopes: command.scopes,
      issuedBy: actorId(command.actor),
      now: this.clock.now(),
    });
    await this.uow.run(() => this.apiKeys.save(apiKey));
    return { ...toApiKeySummary(apiKey), key: secret.value };
  }
}
