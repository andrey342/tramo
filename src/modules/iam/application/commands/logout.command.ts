import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { REFRESH_TOKEN_REPOSITORY, type RefreshTokenRepository } from '../../domain';
import { CREDENTIAL_GENERATOR, type CredentialGenerator } from '../ports/iam-ports';

export class LogoutCommand extends Command<void> {
  constructor(readonly refreshToken: string) {
    super();
  }
}

// Ends the whole session (every token of the family). Unknown or already revoked tokens are
// accepted silently: logging out twice is not an error, and the answer must not reveal anything.
@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(CREDENTIAL_GENERATOR) private readonly credentials: CredentialGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: LogoutCommand): Promise<void> {
    await this.uow.run(async () => {
      const token = await this.refreshTokens.findByTokenHash(
        this.credentials.hash(command.refreshToken),
      );
      if (token) {
        await this.refreshTokens.revokeFamily(token.familyId, this.clock.now());
      }
    });
  }
}
