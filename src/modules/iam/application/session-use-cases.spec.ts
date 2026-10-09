import { FixedClock } from '@shared/domain';

import { aStaffUser, aStudent } from '../../../../test/factories/iam';
import {
  FakeAccessTokenIssuer,
  FakePasswordHasher,
  InMemoryLoginAttemptTracker,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
  SequentialCredentialGenerator,
} from '../../../../test/fakes/iam';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import {
  AccountTemporarilyLockedError,
  EmailAlreadyRegisteredError,
  IamEvents,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
} from '../domain';

import { LoginCommand, LoginHandler } from './commands/login.command';
import { LogoutCommand, LogoutHandler } from './commands/logout.command';
import { RefreshSessionCommand, RefreshSessionHandler } from './commands/refresh-session.command';
import {
  RegisterStudentCommand,
  RegisterStudentHandler,
} from './commands/register-student.command';
import {
  GetCurrentPrincipalHandler,
  GetCurrentPrincipalQuery,
} from './queries/get-current-principal.query';
import { SessionIssuer } from './session-issuer';

const PASSWORD = 'correct horse battery';
const DAY_MS = 24 * 60 * 60 * 1000;

function setup() {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  const uow = new InlineUnitOfWork();
  const events = new RecordingEventBus();
  const users = new InMemoryUserRepository(events);
  const refreshTokens = new InMemoryRefreshTokenRepository(events);
  const hasher = new FakePasswordHasher();
  const credentials = new SequentialCredentialGenerator();
  const attempts = new InMemoryLoginAttemptTracker(clock, {
    maxFailures: 5,
    baseLockSeconds: 60,
    maxLockSeconds: 3600,
  });
  const sessions = new SessionIssuer(refreshTokens, credentials, new FakeAccessTokenIssuer(clock), {
    refreshTokenTtlMs: 30 * DAY_MS,
  });
  return {
    clock,
    events,
    users,
    refreshTokens,
    hasher,
    register: new RegisterStudentHandler(uow, users, hasher, clock),
    login: new LoginHandler(uow, users, hasher, attempts, clock, sessions),
    refresh: new RefreshSessionHandler(
      uow,
      refreshTokens,
      users,
      credentials,
      events,
      clock,
      sessions,
    ),
    logout: new LogoutHandler(uow, refreshTokens, credentials, clock),
    me: new GetCurrentPrincipalHandler(users),
  };
}

describe('session use cases', () => {
  describe('RegisterStudent', () => {
    it('should create a student with a hashed password and publish StudentRegistered', async () => {
      const t = setup();

      const { userId } = await t.register.execute(
        new RegisterStudentCommand(' Ana@Example.com ', PASSWORD),
      );

      const user = await t.users.findById(userId);
      expect(user?.email.value).toBe('ana@example.com');
      expect(user?.passwordHash).toBe(`fake:${PASSWORD}`);
      expect(t.events.ofType(IamEvents.StudentRegistered)).toHaveLength(1);
    });

    it('should refuse an email that is already registered', async () => {
      const t = setup();
      await t.register.execute(new RegisterStudentCommand('ana@example.com', PASSWORD));

      await expect(
        t.register.execute(new RegisterStudentCommand('ANA@example.com', PASSWORD)),
      ).rejects.toThrow(EmailAlreadyRegisteredError);
    });

    it('should refuse a short password before hashing anything', async () => {
      const t = setup();

      await expect(
        t.register.execute(new RegisterStudentCommand('ana@example.com', 'short')),
      ).rejects.toThrow(/between 12 and 128/);
      expect(t.users.all()).toHaveLength(0);
    });
  });

  describe('Login', () => {
    it('should open a session for valid credentials', async () => {
      const t = setup();
      const student = aStudent({ email: 'ana@example.com' });
      await t.users.save(student);

      const session = await t.login.execute(new LoginCommand('ana@example.com', PASSWORD));

      expect(session.accessToken).toBe(`access:${student.id}:student`);
      expect(session.refreshTokenExpiresAt).toEqual(
        new Date(t.clock.now().getTime() + 30 * DAY_MS),
      );
      expect(t.refreshTokens.all()).toHaveLength(1);
    });

    it('should answer the same error for an unknown email and a wrong password', async () => {
      const t = setup();
      await t.users.save(aStudent({ email: 'ana@example.com' }));

      await expect(
        t.login.execute(new LoginCommand('nobody@example.com', PASSWORD)),
      ).rejects.toThrow(InvalidCredentialsError);
      await expect(
        t.login.execute(new LoginCommand('ana@example.com', 'wrong password!')),
      ).rejects.toThrow(InvalidCredentialsError);
      expect(t.hasher.verifications).toBe(2);
    });

    it('should lock the account after five failures and keep extending the lock', async () => {
      const t = setup();
      await t.users.save(aStudent({ email: 'ana@example.com' }));
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await expect(
          t.login.execute(new LoginCommand('ana@example.com', 'wrong password!')),
        ).rejects.toThrow(InvalidCredentialsError);
      }

      await expect(t.login.execute(new LoginCommand('ana@example.com', PASSWORD))).rejects.toThrow(
        AccountTemporarilyLockedError,
      );

      t.clock.advanceBy(61_000);
      await expect(
        t.login.execute(new LoginCommand('ana@example.com', 'wrong password!')),
      ).rejects.toThrow(InvalidCredentialsError);
      t.clock.advanceBy(61_000);
      await expect(t.login.execute(new LoginCommand('ana@example.com', PASSWORD))).rejects.toThrow(
        expect.objectContaining({ retryAfterSeconds: 59 }) as Error,
      );
    });

    it('should rehash a password stored with outdated parameters', async () => {
      const t = setup();
      const student = aStudent({ email: 'ana@example.com', passwordHash: `fake-old:${PASSWORD}` });
      await t.users.save(student);

      await t.login.execute(new LoginCommand('ana@example.com', PASSWORD));

      expect((await t.users.findById(student.id))?.passwordHash).toBe(`fake:${PASSWORD}`);
    });

    it('should not let a disabled user in', async () => {
      const t = setup();
      const student = aStudent({ email: 'ana@example.com' });
      student.disable();
      await t.users.save(student);

      await expect(t.login.execute(new LoginCommand('ana@example.com', PASSWORD))).rejects.toThrow(
        InvalidCredentialsError,
      );
    });
  });

  describe('RefreshSession', () => {
    async function signedIn() {
      const t = setup();
      const student = aStudent({ email: 'ana@example.com' });
      await t.users.save(student);
      const session = await t.login.execute(new LoginCommand('ana@example.com', PASSWORD));
      return { ...t, student, session };
    }

    it('should rotate the refresh token within the same family', async () => {
      const t = await signedIn();

      const next = await t.refresh.execute(new RefreshSessionCommand(t.session.refreshToken));

      expect(next.refreshToken).not.toBe(t.session.refreshToken);
      const families = new Set(t.refreshTokens.all().map((token) => token.familyId));
      expect(families.size).toBe(1);
      expect(
        t.refreshTokens
          .all()
          .map((token) => token.status)
          .sort(),
      ).toEqual(['active', 'rotated']);
    });

    it('should revoke the whole family when a rotated token is presented again', async () => {
      const t = await signedIn();
      const next = await t.refresh.execute(new RefreshSessionCommand(t.session.refreshToken));

      await expect(
        t.refresh.execute(new RefreshSessionCommand(t.session.refreshToken)),
      ).rejects.toThrow(InvalidRefreshTokenError);

      await expect(t.refresh.execute(new RefreshSessionCommand(next.refreshToken))).rejects.toThrow(
        InvalidRefreshTokenError,
      );
      expect(t.events.ofType(IamEvents.RefreshTokenReuseDetected)).toEqual([
        expect.objectContaining({ payload: expect.objectContaining({ userId: t.student.id }) }),
      ]);
    });

    it('should reject unknown and expired tokens', async () => {
      const t = await signedIn();

      await expect(t.refresh.execute(new RefreshSessionCommand('rt-unknown'))).rejects.toThrow(
        InvalidRefreshTokenError,
      );
      t.clock.advanceBy(31 * DAY_MS);
      await expect(
        t.refresh.execute(new RefreshSessionCommand(t.session.refreshToken)),
      ).rejects.toThrow(InvalidRefreshTokenError);
    });

    it('should end the session when the user was disabled meanwhile', async () => {
      const t = await signedIn();
      t.student.disable();
      await t.users.save(t.student);

      await expect(
        t.refresh.execute(new RefreshSessionCommand(t.session.refreshToken)),
      ).rejects.toThrow(InvalidRefreshTokenError);
      expect(t.refreshTokens.all().every((token) => token.status === 'revoked')).toBe(true);
    });
  });

  describe('Logout', () => {
    it('should revoke the family so the refresh token stops working', async () => {
      const t = setup();
      await t.users.save(aStudent({ email: 'ana@example.com' }));
      const session = await t.login.execute(new LoginCommand('ana@example.com', PASSWORD));

      await t.logout.execute(new LogoutCommand(session.refreshToken));
      await t.logout.execute(new LogoutCommand(session.refreshToken));
      await t.logout.execute(new LogoutCommand('rt-never-issued'));

      await expect(
        t.refresh.execute(new RefreshSessionCommand(session.refreshToken)),
      ).rejects.toThrow(InvalidRefreshTokenError);
    });
  });

  describe('GetCurrentPrincipal', () => {
    it('should describe a user from its stored profile and an api key from its claims', async () => {
      const t = setup();
      const ops = aStaffUser('ops');
      await t.users.save(ops);

      await expect(
        t.me.execute(
          new GetCurrentPrincipalQuery({
            kind: 'user',
            userId: ops.id,
            roles: ['ops'],
            centerId: null,
          }),
        ),
      ).resolves.toEqual({
        kind: 'user',
        id: ops.id,
        email: ops.email.value,
        roles: ['ops'],
        centerId: null,
      });
      await expect(
        t.me.execute(
          new GetCurrentPrincipalQuery({
            kind: 'api_key',
            apiKeyId: 'k-1',
            centerId: 'c-1',
            scopes: ['programs:read'],
          }),
        ),
      ).resolves.toEqual({
        kind: 'api_key',
        id: 'k-1',
        centerId: 'c-1',
        scopes: ['programs:read'],
      });
    });
  });
});
