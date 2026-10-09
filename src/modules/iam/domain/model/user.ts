import { AggregateRoot, type Email, type Role } from '@shared/domain';

import { InvalidRoleAssignmentError } from '../errors/iam-errors';
import { IamEvents } from '../events/iam-events';

export type UserStatus = 'active' | 'disabled';

const CENTER_ROLES: readonly Role[] = ['center_admin'];
const STAFF_ROLES: readonly Role[] = ['ops', 'admin'];

export interface UserProps {
  readonly email: Email;
  readonly passwordHash: string;
  readonly roles: readonly Role[];
  readonly centerId: string | null;
  readonly status: UserStatus;
  readonly createdAt: Date;
}

// Students, staff of a training center and Tramo's own staff. A center user always belongs to one
// center; nobody else does. Roles of different kinds are never mixed on one account.
export class User extends AggregateRoot {
  private constructor(
    id: string,
    private props: UserProps,
  ) {
    super(id);
    User.assertRoles(props.roles, props.centerId);
  }

  static registerStudent(input: {
    id: string;
    email: Email;
    passwordHash: string;
    now: Date;
  }): User {
    const user = new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      roles: ['student'],
      centerId: null,
      status: 'active',
      createdAt: input.now,
    });
    user.record({
      eventType: IamEvents.StudentRegistered,
      aggregateType: 'User',
      aggregateId: user.id,
      occurredAt: input.now,
      payload: { userId: user.id, email: input.email.value },
    });
    return user;
  }

  static createCenterUser(input: {
    id: string;
    email: Email;
    passwordHash: string;
    centerId: string;
    roles: readonly Role[];
    now: Date;
  }): User {
    if (input.roles.some((role) => !CENTER_ROLES.includes(role))) {
      throw new InvalidRoleAssignmentError('A center user can only have center roles.');
    }
    const user = new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      roles: [...new Set(input.roles)],
      centerId: input.centerId,
      status: 'active',
      createdAt: input.now,
    });
    user.record({
      eventType: IamEvents.CenterUserCreated,
      aggregateType: 'User',
      aggregateId: user.id,
      occurredAt: input.now,
      payload: {
        userId: user.id,
        email: input.email.value,
        centerId: input.centerId,
        roles: user.roles,
      },
    });
    return user;
  }

  // Operations and admin accounts are provisioned by the seed and by admins, never self-served.
  static createStaff(input: {
    id: string;
    email: Email;
    passwordHash: string;
    roles: readonly Role[];
    now: Date;
  }): User {
    if (input.roles.some((role) => !STAFF_ROLES.includes(role))) {
      throw new InvalidRoleAssignmentError('A staff account can only have staff roles.');
    }
    return new User(input.id, {
      email: input.email,
      passwordHash: input.passwordHash,
      roles: [...new Set(input.roles)],
      centerId: null,
      status: 'active',
      createdAt: input.now,
    });
  }

  static reconstitute(id: string, props: UserProps): User {
    return new User(id, props);
  }

  get email(): Email {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get roles(): readonly Role[] {
    return this.props.roles;
  }

  get centerId(): string | null {
    return this.props.centerId;
  }

  get status(): UserStatus {
    return this.props.status;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get canSignIn(): boolean {
    return this.props.status === 'active';
  }

  hasRole(role: Role): boolean {
    return this.props.roles.includes(role);
  }

  // Called after a successful sign-in when the stored hash uses outdated argon2 parameters.
  replacePasswordHash(passwordHash: string): void {
    this.props = { ...this.props, passwordHash };
  }

  disable(): void {
    this.props = { ...this.props, status: 'disabled' };
  }

  private static assertRoles(roles: readonly Role[], centerId: string | null): void {
    if (roles.length === 0) {
      throw new InvalidRoleAssignmentError('A user needs at least one role.');
    }
    const isCenterUser = roles.some((role) => CENTER_ROLES.includes(role));
    const isStaff = roles.some((role) => STAFF_ROLES.includes(role));
    const isStudent = roles.includes('student');
    if ([isCenterUser, isStaff, isStudent].filter(Boolean).length > 1) {
      throw new InvalidRoleAssignmentError('Student, center and staff roles cannot be combined.');
    }
    if (isCenterUser !== (centerId !== null)) {
      throw new InvalidRoleAssignmentError(
        'Center roles require a center, and only center users belong to one.',
      );
    }
  }
}
