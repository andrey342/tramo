import { uuidv7 } from 'uuidv7';

import {
  ApiKey,
  type ApiKeyRepository,
  RefreshToken,
  type RefreshTokenRepository,
  type User,
  type UserRepository,
} from '../../src/modules/iam/domain';
import { aCenterAdmin, aStudent, DEFAULT_CENTER_ID } from '../factories/iam';

export interface IamRepositoriesHarness {
  readonly users: UserRepository;
  readonly refreshTokens: RefreshTokenRepository;
  readonly apiKeys: ApiKeyRepository;
  // Writes run in a unit of work, as handlers do.
  readonly run: <T>(work: () => Promise<T>) => Promise<T>;
}

const NOW = new Date('2026-10-09T10:00:00.000Z');
const later = (ms: number): Date => new Date(NOW.getTime() + ms);

// The in-memory repositories used by handler tests and the TypeORM ones must answer the same.
// Concurrency (optimistic locking, family locks) is only covered by the integration specs.
export function iamRepositoriesContract(
  name: string,
  create: () => Promise<IamRepositoriesHarness> | IamRepositoriesHarness,
): void {
  describe(`${name} (iam repositories contract)`, () => {
    let t: IamRepositoriesHarness;

    beforeEach(async () => {
      t = await create();
    });

    const saved = async <A extends User>(user: A): Promise<A> => {
      await t.run(() => t.users.save(user));
      return user;
    };

    describe('UserRepository', () => {
      it('should find a saved user by id and by its stored email', async () => {
        const student = await saved(aStudent());

        expect((await t.users.findById(student.id))?.email.value).toBe(student.email.value);
        expect((await t.users.findByEmail(student.email.value))?.id).toBe(student.id);
        expect(await t.users.findByEmail(`missing.${uuidv7()}@example.com`)).toBeNull();
      });

      it('should bump the version on every save', async () => {
        const student = await saved(aStudent());
        const loaded = await t.users.findById(student.id);
        loaded?.replacePasswordHash('fake:new');
        await t.run(() => t.users.save(loaded!));

        expect((await t.users.findById(student.id))?.version).toBe(2);
      });
    });

    describe('RefreshTokenRepository', () => {
      const issue = (userId: string, familyId: string): RefreshToken =>
        RefreshToken.issue({
          id: uuidv7(),
          familyId,
          userId,
          tokenHash: `hash-${uuidv7()}`,
          now: NOW,
          ttlMs: 60_000,
          familyExpiresAt: later(120_000),
        });

      it('should find a token by its hash', async () => {
        const student = await saved(aStudent());
        const token = issue(student.id, uuidv7());
        await t.run(() => t.refreshTokens.save(token));

        expect((await t.refreshTokens.findByTokenHash(token.tokenHash))?.id).toBe(token.id);
        expect(await t.refreshTokens.findByTokenHash('unknown')).toBeNull();
      });

      it('should revoke every live token of one family and count them, once', async () => {
        const student = await saved(aStudent());
        const family = uuidv7();
        const other = issue(student.id, uuidv7());
        const tokens = [issue(student.id, family), issue(student.id, family)];
        await t.run(async () => {
          for (const token of [...tokens, other]) await t.refreshTokens.save(token);
        });

        const revoked = await t.run(async () => {
          await t.refreshTokens.lockFamily(family);
          return t.refreshTokens.revokeFamily(family, later(1_000));
        });
        const again = await t.run(() => t.refreshTokens.revokeFamily(family, later(2_000)));

        expect(revoked).toBe(2);
        expect(again).toBe(0);
        const first = await t.refreshTokens.findByTokenHash(tokens[0]?.tokenHash ?? '');
        expect(first?.status).toBe('revoked');
        expect(first?.usedAt).toEqual(later(1_000));
        expect((await t.refreshTokens.findByTokenHash(other.tokenHash))?.status).toBe('active');
      });
    });

    describe('ApiKeyRepository', () => {
      const issueKey = (createdBy: string, centerId: string, now: Date): ApiKey =>
        ApiKey.issue({
          id: uuidv7(),
          centerId,
          name: 'integration',
          prefix: uuidv7().replace(/-/g, '').slice(-8),
          secretHash: `secret-${uuidv7()}`,
          scopes: ['applications:read'],
          issuedBy: createdBy,
          now,
        });

      it('should find a key by its prefix', async () => {
        const admin = await saved(aCenterAdmin());
        const key = issueKey(admin.id, DEFAULT_CENTER_ID, NOW);
        await t.run(() => t.apiKeys.save(key));

        expect((await t.apiKeys.findByPrefix(key.prefix))?.id).toBe(key.id);
        expect(await t.apiKeys.findByPrefix('00000000')).toBeNull();
      });

      it("should list a center's keys newest first, and only that center's", async () => {
        const centerId = uuidv7();
        const admin = await saved(aCenterAdmin({ centerId }));
        const older = issueKey(admin.id, centerId, NOW);
        const newer = issueKey(admin.id, centerId, later(1_000));
        const foreign = issueKey(admin.id, uuidv7(), later(2_000));
        await t.run(async () => {
          for (const key of [older, newer, foreign]) await t.apiKeys.save(key);
        });

        const listed = await t.apiKeys.listByCenter(centerId);

        expect(listed.map((key) => key.id)).toEqual([newer.id, older.id]);
      });

      it('should record the latest use and ignore an older one arriving late', async () => {
        const admin = await saved(aCenterAdmin());
        const key = issueKey(admin.id, DEFAULT_CENTER_ID, NOW);
        await t.run(() => t.apiKeys.save(key));

        await t.apiKeys.recordUse(key.id, later(5_000));
        await t.apiKeys.recordUse(key.id, later(1_000));

        expect((await t.apiKeys.findById(key.id))?.lastUsedAt).toEqual(later(5_000));
      });
    });
  });
}
