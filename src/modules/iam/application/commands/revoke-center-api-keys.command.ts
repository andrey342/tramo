import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { API_KEY_REPOSITORY, type ApiKeyRepository } from '../../domain';

// A suspended center's integrations stop at once: every key it still has is revoked, each with
// its ApiKeyRevoked. Keys stay revoked if the center is reinstated; its admins issue new ones.
// Keys already revoked are left as they are, so a redelivered suspension changes nothing.
// Returns how many keys were revoked.
export class RevokeCenterApiKeysCommand extends Command<number> {
  constructor(readonly centerId: string) {
    super();
  }
}

@CommandHandler(RevokeCenterApiKeysCommand)
export class RevokeCenterApiKeysHandler implements ICommandHandler<RevokeCenterApiKeysCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(API_KEY_REPOSITORY) private readonly apiKeys: ApiKeyRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  execute(command: RevokeCenterApiKeysCommand): Promise<number> {
    const now = this.clock.now();
    return this.uow.run(async () => {
      // A center has a handful of keys (listByCenter is bounded by design).
      const active = (await this.apiKeys.listByCenter(command.centerId)).filter(
        (key) => key.isActive,
      );
      for (const key of active) {
        key.revoke(now);
        await this.apiKeys.save(key);
      }
      return active.length;
    });
  }
}
