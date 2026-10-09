import { type LoginAttemptTracker } from '../../src/modules/iam/application/ports/iam-ports';

// The in-memory fake used by unit tests and the Redis adapter must behave the same; both run this
// suite with a policy of 3 failures, 60 s base lock, 3600 s cap.
export function loginAttemptTrackerContract(
  name: string,
  create: () => Promise<LoginAttemptTracker> | LoginAttemptTracker,
): void {
  describe(`${name} (LoginAttemptTracker contract)`, () => {
    let tracker: LoginAttemptTracker;
    let account: string;

    beforeEach(async () => {
      tracker = await create();
      account = `user-${String(Math.random()).slice(2)}@example.com`;
    });

    it('should not lock an account below the failure threshold', async () => {
      await tracker.recordFailure(account);
      await tracker.recordFailure(account);

      expect(await tracker.lockedFor(account)).toBe(0);
    });

    it('should lock for the base duration when the threshold is reached', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await tracker.recordFailure(account);
      }

      const lockedFor = await tracker.lockedFor(account);
      expect(lockedFor).toBeGreaterThan(55);
      expect(lockedFor).toBeLessThanOrEqual(60);
    });

    it('should double the lock with every further failure', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await tracker.recordFailure(account);
      }

      expect(await tracker.lockedFor(account)).toBeGreaterThan(235);
    });

    it('should cap the lock duration', async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await tracker.recordFailure(account);
      }

      expect(await tracker.lockedFor(account)).toBeLessThanOrEqual(3600);
    });

    it('should forget failures and locks on reset', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await tracker.recordFailure(account);
      }
      await tracker.reset(account);
      await tracker.recordFailure(account);

      expect(await tracker.lockedFor(account)).toBe(0);
    });

    it('should keep accounts independent', async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await tracker.recordFailure(account);
      }

      expect(await tracker.lockedFor(`other-${account}`)).toBe(0);
    });
  });
}
