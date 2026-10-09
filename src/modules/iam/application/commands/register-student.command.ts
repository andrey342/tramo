import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, Email, unwrap } from '@shared/domain';

import {
  assertPasswordPolicy,
  EmailAlreadyRegisteredError,
  User,
  USER_REPOSITORY,
  type UserRepository,
} from '../../domain';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/iam-ports';

export class RegisterStudentCommand extends Command<{ userId: string }> {
  constructor(
    readonly email: string,
    readonly password: string,
  ) {
    super();
  }
}

@CommandHandler(RegisterStudentCommand)
export class RegisterStudentHandler implements ICommandHandler<RegisterStudentCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RegisterStudentCommand): Promise<{ userId: string }> {
    const email = unwrap(Email.create(command.email));
    assertPasswordPolicy(command.password);
    // Hashing takes tens of milliseconds; doing it before the transaction keeps the transaction short.
    const passwordHash = await this.hasher.hash(command.password);

    return this.uow.run(async () => {
      if (await this.users.findByEmail(email.value)) {
        throw new EmailAlreadyRegisteredError();
      }
      const user = User.registerStudent({
        id: uuidv7(),
        email,
        passwordHash,
        now: this.clock.now(),
      });
      await this.users.save(user);
      return { userId: user.id };
    });
  }
}
