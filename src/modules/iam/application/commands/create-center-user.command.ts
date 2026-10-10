import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import {
  AUDIT_TRAIL,
  type AuditTrail,
  type Principal,
  UNIT_OF_WORK,
  type UnitOfWork,
} from '@shared/application';
import { CLOCK, type Clock, Email, EntityNotFoundError, unwrap } from '@shared/domain';

import {
  assertPasswordPolicy,
  EmailAlreadyRegisteredError,
  User,
  USER_REPOSITORY,
  type UserRepository,
} from '../../domain';
import { assertIsAdmin } from '../center-access';
import {
  CENTER_DIRECTORY,
  type CenterDirectory,
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../ports/iam-ports';

export class CreateCenterUserCommand extends Command<{ userId: string }> {
  constructor(
    readonly actor: Principal,
    readonly centerId: string,
    readonly email: string,
    readonly password: string,
  ) {
    super();
  }
}

// Admins onboard the first administrator of a training center. The initial password is set by the
// admin and shared out of band; an invitation email flow would replace it in production.
@CommandHandler(CreateCenterUserCommand)
export class CreateCenterUserHandler implements ICommandHandler<CreateCenterUserCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(AUDIT_TRAIL) private readonly audit: AuditTrail,
    @Inject(CENTER_DIRECTORY) private readonly centers: CenterDirectory,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: CreateCenterUserCommand): Promise<{ userId: string }> {
    assertIsAdmin(command.actor, command.centerId);
    if (!(await this.centers.exists(command.centerId))) {
      throw new EntityNotFoundError('TrainingCenter', command.centerId);
    }
    const email = unwrap(Email.create(command.email));
    assertPasswordPolicy(command.password);
    const passwordHash = await this.hasher.hash(command.password);

    return this.uow.run(async () => {
      if (await this.users.findByEmail(email.value)) {
        throw new EmailAlreadyRegisteredError();
      }
      const user = User.createCenterUser({
        id: uuidv7(),
        email,
        passwordHash,
        centerId: command.centerId,
        roles: ['center_admin'],
        now: this.clock.now(),
      });
      await this.users.save(user);
      this.audit.describeChanges({ roles: { before: null, after: [...user.roles] } });
      return { userId: user.id };
    });
  }
}
