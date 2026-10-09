import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { type Principal, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import { API_KEY_REPOSITORY, type ApiKeyRepository } from '../../domain';
import { assertCanManageCenter } from '../center-access';

export class RevokeApiKeyCommand extends Command<void> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly apiKeyId: string,
  ) {
    super();
  }
}

@CommandHandler(RevokeApiKeyCommand)
export class RevokeApiKeyHandler implements ICommandHandler<RevokeApiKeyCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RevokeApiKeyCommand): Promise<void> {
    assertCanManageCenter(command.actor, command.centerId);
    await this.uow.run(async () => {
      const apiKey = await this.apiKeys.findById(command.apiKeyId);
      // A key of another center is reported as missing, not as forbidden: its existence is not
      // the caller's business.
      if (apiKey?.centerId !== command.centerId) {
        throw new EntityNotFoundError('ApiKey', command.apiKeyId);
      }
      apiKey.revoke(this.clock.now());
      await this.apiKeys.save(apiKey);
    });
  }
}
