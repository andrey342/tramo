import { FixedClock } from '@shared/domain';

import { loginAttemptTrackerContract } from '../../../../../test/contracts/login-attempt-tracker.contract';
import { InMemoryLoginAttemptTracker } from '../../../../../test/fakes/iam';

loginAttemptTrackerContract(
  'InMemoryLoginAttemptTracker',
  () =>
    new InMemoryLoginAttemptTracker(new FixedClock(new Date('2026-10-09T10:00:00Z')), {
      maxFailures: 3,
      baseLockSeconds: 60,
      maxLockSeconds: 3600,
    }),
);
