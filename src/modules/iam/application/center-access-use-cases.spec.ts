import { type Principal } from '@shared/application';
import { EntityNotFoundError, FixedClock } from '@shared/domain';

import { aCenterAdmin, aStaffUser, DEFAULT_CENTER_ID } from '../../../../test/factories/iam';
import {
  FakeCenterDirectory,
  FakePasswordHasher,
  InMemoryApiKeyRepository,
  InMemoryUserRepository,
  SequentialCredentialGenerator,
} from '../../../../test/fakes/iam';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../test/fakes/shared';
import { API_KEY_FORMAT, CenterAccessDeniedError, IamEvents } from '../domain';

import {
  CreateCenterUserCommand,
  CreateCenterUserHandler,
} from './commands/create-center-user.command';
import { IssueApiKeyCommand, IssueApiKeyHandler } from './commands/issue-api-key.command';
import { RevokeApiKeyCommand, RevokeApiKeyHandler } from './commands/revoke-api-key.command';
import {
  AuthenticateApiKeyHandler,
  AuthenticateApiKeyQuery,
} from './queries/authenticate-api-key.query';
import { ListApiKeysHandler, ListApiKeysQuery } from './queries/list-api-keys.query';

const OTHER_CENTER_ID = '0199a000-0000-7000-8000-00000000c002';
const asUser = (user: {
  id: string;
  roles: readonly string[];
  centerId: string | null;
}): Principal =>
  ({ kind: 'user', userId: user.id, roles: user.roles, centerId: user.centerId }) as Principal;

function setup(knownCenters?: ReadonlySet<string>) {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  const uow = new InlineUnitOfWork();
  const events = new RecordingEventBus();
  const users = new InMemoryUserRepository(events);
  const apiKeys = new InMemoryApiKeyRepository(events);
  const credentials = new SequentialCredentialGenerator();
  const changes: unknown[] = [];
  const centers = new FakeCenterDirectory(knownCenters);
  return {
    clock,
    events,
    users,
    apiKeys,
    changes,
    createCenterUser: new CreateCenterUserHandler(
      uow,
      users,
      new FakePasswordHasher(),
      { describeChanges: (change) => changes.push(change) },
      centers,
      clock,
    ),
    issue: new IssueApiKeyHandler(uow, apiKeys, credentials, centers, clock),
    revoke: new RevokeApiKeyHandler(uow, apiKeys, clock),
    list: new ListApiKeysHandler(apiKeys),
    authenticate: new AuthenticateApiKeyHandler(apiKeys, credentials, clock),
  };
}

describe('center access use cases', () => {
  const admin = aStaffUser('admin');
  const centerAdmin = aCenterAdmin({ centerId: DEFAULT_CENTER_ID });

  describe('CreateCenterUser', () => {
    it('should let an admin create a center administrator', async () => {
      const t = setup();

      const { userId } = await t.createCenterUser.execute(
        new CreateCenterUserCommand(
          asUser(admin),
          DEFAULT_CENTER_ID,
          'boss@center.test',
          'a long password',
        ),
      );

      const created = await t.users.findById(userId);
      expect(created?.roles).toEqual(['center_admin']);
      expect(created?.centerId).toBe(DEFAULT_CENTER_ID);
      expect(t.events.ofType(IamEvents.CenterUserCreated)).toHaveLength(1);
      expect(t.changes).toEqual([{ roles: { before: null, after: ['center_admin'] } }]);
    });

    it('should refuse a center that does not exist', async () => {
      const t = setup(new Set());

      await expect(
        t.createCenterUser.execute(
          new CreateCenterUserCommand(
            asUser(admin),
            DEFAULT_CENTER_ID,
            'x@center.test',
            'a long password',
          ),
        ),
      ).rejects.toThrow(EntityNotFoundError);
      await expect(
        t.issue.execute(
          new IssueApiKeyCommand(asUser(admin), DEFAULT_CENTER_ID, 'x', ['programs:read']),
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });

    it('should not let anyone else do it', async () => {
      const t = setup();

      await expect(
        t.createCenterUser.execute(
          new CreateCenterUserCommand(
            asUser(centerAdmin),
            DEFAULT_CENTER_ID,
            'x@center.test',
            'a long password',
          ),
        ),
      ).rejects.toThrow(CenterAccessDeniedError);
    });
  });

  describe('API keys', () => {
    it('should issue a key once, list it without the secret and authenticate with it', async () => {
      const t = setup();

      const issued = await t.issue.execute(
        new IssueApiKeyCommand(asUser(centerAdmin), DEFAULT_CENTER_ID, 'ATS', [
          'applications:write',
        ]),
      );
      const listed = await t.list.execute(
        new ListApiKeysQuery(asUser(centerAdmin), DEFAULT_CENTER_ID),
      );

      expect(issued.key).toMatch(API_KEY_FORMAT);
      expect(listed).toEqual([expect.not.objectContaining({ key: expect.anything() })]);
      expect(t.events.ofType(IamEvents.ApiKeyIssued)).toHaveLength(1);
    });

    it('should let only admins and the center own administrators manage keys', async () => {
      const t = setup();
      const foreignAdmin = aCenterAdmin({ centerId: OTHER_CENTER_ID });

      await expect(
        t.issue.execute(
          new IssueApiKeyCommand(asUser(foreignAdmin), DEFAULT_CENTER_ID, 'x', ['programs:read']),
        ),
      ).rejects.toThrow(CenterAccessDeniedError);
      await expect(
        t.issue.execute(
          new IssueApiKeyCommand(asUser(admin), DEFAULT_CENTER_ID, 'x', ['programs:read']),
        ),
      ).resolves.toBeDefined();
      await expect(
        t.list.execute(
          new ListApiKeysQuery(
            { kind: 'api_key', apiKeyId: 'k', centerId: DEFAULT_CENTER_ID, scopes: [] },
            DEFAULT_CENTER_ID,
          ),
        ),
      ).rejects.toThrow(CenterAccessDeniedError);
    });

    it('should report a key of another center as not found when revoking', async () => {
      const t = setup();
      const issued = await t.issue.execute(
        new IssueApiKeyCommand(asUser(admin), OTHER_CENTER_ID, 'x', ['programs:read']),
      );

      await expect(
        t.revoke.execute(
          new RevokeApiKeyCommand(asUser(centerAdmin), DEFAULT_CENTER_ID, issued.id),
        ),
      ).rejects.toThrow(EntityNotFoundError);
    });
  });

  describe('AuthenticateApiKey', () => {
    async function withKey() {
      const t = setup();
      const issued = await t.issue.execute(
        new IssueApiKeyCommand(asUser(centerAdmin), DEFAULT_CENTER_ID, 'ATS', [
          'applications:write',
        ]),
      );
      return { ...t, issued };
    }

    it('should resolve a valid key to a center principal and record its use', async () => {
      const t = await withKey();

      const principal = await t.authenticate.execute(new AuthenticateApiKeyQuery(t.issued.key));

      expect(principal).toEqual({
        kind: 'api_key',
        apiKeyId: t.issued.id,
        centerId: DEFAULT_CENTER_ID,
        scopes: ['applications:write'],
      });
      expect((await t.apiKeys.findById(t.issued.id))?.lastUsedAt).toEqual(t.clock.now());
    });

    it('should reject malformed, unknown, tampered and revoked keys alike', async () => {
      const t = await withKey();
      const tampered = `${t.issued.key.slice(0, -1)}x`;

      expect(await t.authenticate.execute(new AuthenticateApiKeyQuery('nonsense'))).toBeNull();
      expect(await t.authenticate.execute(new AuthenticateApiKeyQuery(tampered))).toBeNull();

      await t.revoke.execute(
        new RevokeApiKeyCommand(asUser(centerAdmin), DEFAULT_CENTER_ID, t.issued.id),
      );
      expect(await t.authenticate.execute(new AuthenticateApiKeyQuery(t.issued.key))).toBeNull();
    });
  });
});
