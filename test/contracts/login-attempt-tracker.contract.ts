import { type LoginAttemptTracker } from '../../src/modules/iam/application/ports/iam-ports';

// Policy every implementation runs this suite with: lock after 3 attempts, 1 s base lock, 2 s cap.
export const CONTRACT_LOCKOUT_POLICY = {
  maxFailures: 3,
  baseLockSeconds: 1,
  maxLockSeconds: 2,
} as const;

export interface LoginAttemptTrackerHarness {
  readonly tracker: LoginAttemptTracker;
  // Lets time pass: a fake clock moves forward, a real store is waited on.
  readonly wait: (ms: number) => Promise<void>;
}

// The in-memory fake used by unit tests and the Redis adapter must behave the same.
export function loginAttemptTrackerContract(
  name: string,
  create: () => Promise<LoginAttemptTrackerHarness> | LoginAttemptTrackerHarness,
): void {
  describe(`${name} (LoginAttemptTracker contract)`, () => {
    let tracker: LoginAttemptTracker;
    let wait: (ms: number) => Promise<void>;
    let account: string;

    const attempts = async (count: number): Promise<number[]> => {
      const results: number[] = [];
      for (let attempt = 0; attempt < count; attempt += 1) {
        results.push(await tracker.begin(account));
      }
      return results;
    };

    beforeEach(async () => {
      ({ tracker, wait } = await create());
      account = `user-${String(Math.random()).slice(2)}@example.com`;
    });

    it('should let attempts through up to the threshold, then lock for the base duration', async () => {
      expect(await attempts(3)).toEqual([0, 0, 0]);

      expect(await tracker.begin(account)).toBe(1);
    });

    it('should let only the threshold through when attempts arrive in parallel', async () => {
      const results = await Promise.all(Array.from({ length: 10 }, () => tracker.begin(account)));

      expect(results.filter((lockedFor) => lockedFor === 0)).toHaveLength(3);
    });

    it('should double the lock after each further failed attempt, up to the cap', async () => {
      await attempts(3);
      await wait(1_100);

      expect(await tracker.begin(account)).toBe(0);
      expect(await tracker.begin(account)).toBe(2);

      await wait(2_100);
      expect(await tracker.begin(account)).toBe(0);
      expect(await tracker.begin(account)).toBe(2);
    });

    it('should forget failed attempts and locks after a success', async () => {
      await attempts(3);
      await tracker.succeeded(account);

      expect(await attempts(3)).toEqual([0, 0, 0]);
    });

    it('should keep accounts independent', async () => {
      await attempts(4);

      expect(await tracker.begin(`other-${account}`)).toBe(0);
    });
  });
}
