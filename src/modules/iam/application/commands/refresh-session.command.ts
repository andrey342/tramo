import { Inject, Logger } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { EVENT_BUS, type EventBus, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  IamEvents,
  InvalidRefreshTokenError,
  REFRESH_TOKEN_REPOSITORY,
  type RefreshToken,
  type RefreshTokenRepository,
  type RefreshTokenReuseDetected,
  USER_REPOSITORY,
  type UserRepository,
} from '../../domain';
import { type SessionTokensDto } from '../dto/session.dto';
import { CREDENTIAL_GENERATOR, type CredentialGenerator } from '../ports/iam-ports';
import { SessionIssuer } from '../session-issuer';

export class RefreshSessionCommand extends Command<SessionTokensDto> {
  constructor(readonly refreshToken: string) {
    super();
  }
}

@CommandHandler(RefreshSessionCommand)
export class RefreshSessionHandler implements ICommandHandler<RefreshSessionCommand> {
  private readonly logger = new Logger(RefreshSessionHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(CREDENTIAL_GENERATOR) private readonly credentials: CredentialGenerator,
    @Inject(EVENT_BUS) private readonly events: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(command: RefreshSessionCommand): Promise<SessionTokensDto> {
    const now = this.clock.now();
    // Rejections commit their own side effects (revocation) and are thrown after the transaction,
    // otherwise the rollback would undo the revocation.
    const outcome = await this.uow.run(async () => {
      const token = await this.refreshTokens.findByTokenHash(
        this.credentials.hash(command.refreshToken),
      );
      if (!token) {
        return null;
      }
      const consumed = token.consume(now);
      if (!consumed.ok) {
        if (consumed.error === 'reused') {
          await this.revokeAfterReuse(token, now);
        }
        return null;
      }
      const user = await this.users.findById(token.userId);
      if (!user?.canSignIn) {
        await this.refreshTokens.revokeFamily(token.familyId, now);
        return null;
      }
      await this.refreshTokens.save(token);
      return this.sessions.issue(user, now, token.familyId);
    });
    if (!outcome) {
      throw new InvalidRefreshTokenError();
    }
    return outcome;
  }

  private async revokeAfterReuse(token: RefreshToken, now: Date): Promise<void> {
    const revokedTokens = await this.refreshTokens.revokeFamily(token.familyId, now);
    this.logger.warn(
      { userId: token.userId, familyId: token.familyId, revokedTokens },
      'Refresh token reuse detected; session family revoked',
    );
    const event: RefreshTokenReuseDetected = {
      eventType: IamEvents.RefreshTokenReuseDetected,
      aggregateType: 'User',
      aggregateId: token.userId,
      occurredAt: now,
      payload: { userId: token.userId, familyId: token.familyId, revokedTokens },
    };
    await this.events.publish([event]);
  }
}
