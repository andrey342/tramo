import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, ConcurrentModificationError, Email } from '@shared/domain';

import {
  AccountTemporarilyLockedError,
  InvalidCredentialsError,
  type User,
  USER_REPOSITORY,
  type UserRepository,
} from '../../domain';
import { type SessionTokensDto } from '../dto/session.dto';
import {
  LOGIN_ATTEMPTS,
  type LoginAttemptTracker,
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../ports/iam-ports';
import { SessionIssuer } from '../session-issuer';

export class LoginCommand extends Command<SessionTokensDto> {
  constructor(
    readonly email: string,
    readonly password: string,
  ) {
    super();
  }
}

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(LOGIN_ATTEMPTS) private readonly attempts: LoginAttemptTracker,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly sessions: SessionIssuer,
  ) {}

  async execute(command: LoginCommand): Promise<SessionTokensDto> {
    const account = Email.normalize(command.email);
    // The attempt counts as failed until the password checks out.
    const lockedFor = await this.attempts.begin(account);
    if (lockedFor > 0) {
      throw new AccountTemporarilyLockedError(lockedFor);
    }

    const user = await this.authenticate(account, command.password);
    if (!user) {
      throw new InvalidCredentialsError();
    }
    await this.attempts.succeeded(account);

    if (this.hasher.needsRehash(user.passwordHash)) {
      await this.upgradeHash(user, command.password);
    }
    return this.uow.run(() => this.sessions.issue(user, this.clock.now()));
  }

  // Best effort: if another request changed the user meanwhile, the next sign-in upgrades it.
  private async upgradeHash(user: User, password: string): Promise<void> {
    user.replacePasswordHash(await this.hasher.hash(password));
    try {
      await this.uow.run(() => this.users.save(user));
    } catch (error) {
      if (!(error instanceof ConcurrentModificationError)) {
        throw error;
      }
    }
  }

  // Unknown accounts still pay for one hash verification, so response time does not reveal which
  // emails are registered.
  private async authenticate(account: string, password: string): Promise<User | null> {
    const user = await this.users.findByEmail(account);
    const valid = await this.hasher.verify(user?.passwordHash ?? this.hasher.decoyHash, password);
    return user && valid && user.canSignIn ? user : null;
  }
}
