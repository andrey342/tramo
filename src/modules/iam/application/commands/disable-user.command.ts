import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock, EntityNotFoundError } from '@shared/domain';

import {
  CannotDisableOwnAccountError,
  REFRESH_TOKEN_REPOSITORY,
  type RefreshTokenRepository,
  USER_REPOSITORY,
  UserAdministrationDeniedError,
  type UserRepository,
} from '../../domain';

export class DisableUserCommand extends Command<void> {
  constructor(
    readonly actor: Principal,
    readonly userId: string,
  ) {
    super();
  }
}

// Takes an account away: it can no longer sign in, and every session it has ends now (its refresh
// tokens are revoked in the same transaction). Access tokens already issued stay valid until they
// expire, at most 15 minutes, because requests are authenticated from the token alone. Disabling
// an account twice changes nothing and is not an error.
@CommandHandler(DisableUserCommand)
export class DisableUserHandler implements ICommandHandler<DisableUserCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(REFRESH_TOKEN_REPOSITORY) private readonly refreshTokens: RefreshTokenRepository,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: DisableUserCommand): Promise<void> {
    const { actor } = command;
    if (actor.kind !== 'user' || !actor.roles.includes('admin')) {
      throw new UserAdministrationDeniedError();
    }
    if (actor.userId === command.userId) {
      throw new CannotDisableOwnAccountError();
    }
    const now = this.clock.now();
    await this.uow.run(async () => {
      const user = await this.users.findById(command.userId);
      if (!user) {
        throw new EntityNotFoundError('User', command.userId);
      }
      if (user.canSignIn) {
        user.disable(now);
        await this.users.save(user);
        this.audit.describeChanges({ status: { before: 'active', after: user.status } });
      }
      // Also on a repeated call: a session opened by a sign-in that raced the first one ends too.
      await this.refreshTokens.revokeAllOfUser(user.id, now);
    });
  }
}
