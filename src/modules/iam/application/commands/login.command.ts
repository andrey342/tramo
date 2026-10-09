import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

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
    const account = command.email.trim().toLowerCase();
    const lockedFor = await this.attempts.lockedFor(account);
    if (lockedFor > 0) {
      throw new AccountTemporarilyLockedError(lockedFor);
    }

    const user = await this.authenticate(account, command.password);
    if (!user) {
      await this.attempts.recordFailure(account);
      throw new InvalidCredentialsError();
    }
    await this.attempts.reset(account);

    return this.uow.run(async () => {
      if (this.hasher.needsRehash(user.passwordHash)) {
        user.replacePasswordHash(await this.hasher.hash(command.password));
        await this.users.save(user);
      }
      return this.sessions.issue(user, this.clock.now());
    });
  }

  // Unknown accounts still pay for one hash verification, so response time does not reveal which
  // emails are registered.
  private async authenticate(account: string, password: string): Promise<User | null> {
    const user = await this.users.findByEmail(account);
    const valid = await this.hasher.verify(user?.passwordHash ?? this.hasher.decoyHash, password);
    return user && valid && user.canSignIn ? user : null;
  }
}
