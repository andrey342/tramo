import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { Email, unwrap } from '@shared/domain';

import {
  PASSWORD_HASHER,
  type PasswordHasher,
} from '../../src/modules/iam/application/ports/iam-ports';
import { User, USER_REPOSITORY, type UserRepository } from '../../src/modules/iam/domain';

export const TEST_PASSWORD = 'correct horse battery staple';

// Staff accounts are never self-registered, so e2e tests provision them through the repository,
// the same way the seed script does.
export async function createStaffUser(
  app: INestApplication,
  role: 'ops' | 'admin',
): Promise<{ email: string; password: string }> {
  const email = `${role}-${uuidv7().slice(-12)}@tramo.test`;
  const hasher = app.get<PasswordHasher>(PASSWORD_HASHER);
  const users = app.get<UserRepository>(USER_REPOSITORY);
  const passwordHash = await hasher.hash(TEST_PASSWORD);
  await app.get<UnitOfWork>(UNIT_OF_WORK).run(() =>
    users.save(
      User.createStaff({
        id: uuidv7(),
        email: unwrap(Email.create(email)),
        passwordHash,
        roles: [role],
        now: new Date(),
      }),
    ),
  );
  return { email, password: TEST_PASSWORD };
}

export async function accessTokenFor(
  app: INestApplication,
  credentials: { email: string; password: string },
): Promise<string> {
  const response = await request(app.getHttpServer()).post('/api/v1/auth/login').send(credentials);
  if (response.status !== 200) {
    throw new Error(`Login failed for ${credentials.email}: ${String(response.status)}`);
  }
  return (response.body as { accessToken: string }).accessToken;
}
