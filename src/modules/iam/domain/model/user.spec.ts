import { Email, unwrap } from '@shared/domain';

import { InvalidRoleAssignmentError } from '../errors/iam-errors';
import { IamEvents } from '../events/iam-events';

import { User } from './user';

const NOW = new Date('2026-10-09T10:00:00Z');
const email = (value: string): Email => unwrap(Email.create(value));

describe('User', () => {
  it('should register a student and announce it', () => {
    const user = User.registerStudent({
      id: 'u-1',
      email: email('Ana@Example.com'),
      passwordHash: 'hash',
      now: NOW,
    });

    expect(user.roles).toEqual(['student']);
    expect(user.centerId).toBeNull();
    expect(user.canSignIn).toBe(true);
    expect(user.pullEvents()).toEqual([
      {
        eventType: IamEvents.StudentRegistered,
        aggregateType: 'User',
        aggregateId: 'u-1',
        occurredAt: NOW,
        payload: { userId: 'u-1', email: 'ana@example.com' },
      },
    ]);
  });

  it('should tie a center user to its center', () => {
    const user = User.createCenterUser({
      id: 'u-2',
      email: email('admin@bootcamp.test'),
      passwordHash: 'hash',
      centerId: 'center-1',
      roles: ['center_admin', 'center_admin'],
      now: NOW,
    });

    expect(user.centerId).toBe('center-1');
    expect(user.roles).toEqual(['center_admin']);
    expect(user.pullEvents()[0]?.eventType).toBe(IamEvents.CenterUserCreated);
  });

  it('should refuse non-center roles on a center user', () => {
    expect(() =>
      User.createCenterUser({
        id: 'u-3',
        email: email('x@bootcamp.test'),
        passwordHash: 'hash',
        centerId: 'center-1',
        roles: ['admin'],
        now: NOW,
      }),
    ).toThrow(InvalidRoleAssignmentError);
  });

  it('should refuse center roles without a center and mixed role kinds', () => {
    const props = {
      email: email('x@tramo.test'),
      passwordHash: 'hash',
      status: 'active' as const,
      createdAt: NOW,
    };

    expect(() =>
      User.reconstitute('u-4', { ...props, roles: ['center_admin'], centerId: null }),
    ).toThrow(InvalidRoleAssignmentError);
    expect(() =>
      User.reconstitute('u-5', { ...props, roles: ['student', 'ops'], centerId: null }),
    ).toThrow(InvalidRoleAssignmentError);
    expect(() => User.reconstitute('u-6', { ...props, roles: [], centerId: null })).toThrow(
      InvalidRoleAssignmentError,
    );
  });

  it('should create staff accounts without events and only with staff roles', () => {
    const ops = User.createStaff({
      id: 'u-7',
      email: email('ops@tramo.test'),
      passwordHash: 'hash',
      roles: ['ops'],
      now: NOW,
    });

    expect(ops.hasRole('ops')).toBe(true);
    expect(ops.pullEvents()).toEqual([]);
    expect(() =>
      User.createStaff({
        id: 'u-8',
        email: email('x@tramo.test'),
        passwordHash: 'hash',
        roles: ['student'],
        now: NOW,
      }),
    ).toThrow(InvalidRoleAssignmentError);
  });

  it('should stop a disabled user from signing in and accept a rehashed password', () => {
    const user = User.registerStudent({
      id: 'u-9',
      email: email('ana@example.com'),
      passwordHash: 'old',
      now: NOW,
    });
    user.replacePasswordHash('new');
    user.disable();

    expect(user.passwordHash).toBe('new');
    expect(user.canSignIn).toBe(false);
    expect(user.status).toBe('disabled');
    expect(user.email.value).toBe('ana@example.com');
    expect(user.createdAt).toEqual(NOW);
  });
});
