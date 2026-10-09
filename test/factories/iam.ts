import { uuidv7 } from 'uuidv7';

import { Email, type Role, unwrap } from '@shared/domain';

import { User } from '../../src/modules/iam/domain';

// Test files share one database, so generated emails must be unique across files, not per file.
const unique = (): string => uuidv7().slice(-12);

const NOW = new Date('2026-10-09T10:00:00Z');
export const DEFAULT_CENTER_ID = '0199a000-0000-7000-8000-00000000c001';

// Builders give each test the smallest valid object plus the one detail it cares about.
export function aStudent(overrides: { email?: string; passwordHash?: string } = {}): User {
  return User.registerStudent({
    id: uuidv7(),
    email: unwrap(Email.create(overrides.email ?? `student-${unique()}@example.com`)),
    passwordHash: overrides.passwordHash ?? 'fake:correct horse battery',
    now: NOW,
  });
}

export function aCenterAdmin(overrides: { centerId?: string; email?: string } = {}): User {
  return User.createCenterUser({
    id: uuidv7(),
    email: unwrap(Email.create(overrides.email ?? `admin-${unique()}@center.test`)),
    passwordHash: 'fake:correct horse battery',
    centerId: overrides.centerId ?? DEFAULT_CENTER_ID,
    roles: ['center_admin'],
    now: NOW,
  });
}

export function aStaffUser(role: Extract<Role, 'ops' | 'admin'> = 'ops'): User {
  return User.createStaff({
    id: uuidv7(),
    email: unwrap(Email.create(`${role}-${unique()}@tramo.test`)),
    passwordHash: 'fake:correct horse battery',
    roles: [role],
    now: NOW,
  });
}
