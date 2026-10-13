import { Inject, Logger } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
  SessionOwnerRequiredError,
} from '../../domain';

export class RevokeOwnSessionsCommand extends Command<void> {
  constructor(readonly actor: Principal) {
    super();
  }
}

// "Sign me out everywhere": a user who suspects a stolen refresh token ends every session of
// theirs, the one making the request included, each family under its lock (ADR 013). Access
// tokens already issued keep working until they expire, at most 15 minutes, as after disabling an
// account. Only users have sessions; an API key is revoked instead.
@CommandHandler(RevokeOwnSessionsCommand)
export class RevokeOwnSessionsHandler implements ICommandHandler<RevokeOwnSessionsCommand> {
  private readonly logger = new Logger(RevokeOwnSessionsHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute({ actor }: RevokeOwnSessionsCommand): Promise<void> {
    if (actor.kind !== 'user') {
      throw new SessionOwnerRequiredError();
    }
    const revoked = await this.uow.run(() =>
      this.refreshTokens.revokeAllOfUser(actor.userId, this.clock.now()),
    );
    this.audit.describeChanges({ revokedRefreshTokens: { before: null, after: revoked } });
    this.logger.log({ userId: actor.userId, revokedTokens: revoked }, 'Sessions revoked by owner');
  }
}
