import { Inject, Logger } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { EVENT_BUS, type EventBus, UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, ConcurrentModificationError } from '@shared/domain';

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
    const outcome = await this.uow
      .run(async () => this.rotate(command.refreshToken, now))
      .catch((error: unknown) => {
        // Two requests raced with the same token (a retried request, a double click): one of them
        // rotated it first. Not theft, so the session survives; the loser just has to use the
        // winner's token.
        if (error instanceof ConcurrentModificationError) {
          return null;
        }
        throw error;
      });
    if (!outcome) {
      throw new InvalidRefreshTokenError();
    }
    return outcome;
  }

  private async rotate(refreshToken: string, now: Date): Promise<SessionTokensDto | null> {
    const tokenHash = this.credentials.hash(refreshToken);
    const found = await this.refreshTokens.findByTokenHash(tokenHash);
    if (!found) {
      return null;
    }
    // Serialised with logout and reuse revocation of the same family; reading the token again
    // after the lock sees a revocation that committed meanwhile.
    await this.refreshTokens.lockFamily(found.familyId);
    const token = await this.refreshTokens.findByTokenHash(tokenHash);
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
    return this.sessions.issue(user, now, { id: token.familyId, expiresAt: token.familyExpiresAt });
  }

  // The event describes the session family, which is not an aggregate: it is one bulk UPDATE
  // (ADR 013). So the handler publishes it itself, still inside the unit of work, instead of an
  // aggregate recording it.
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
