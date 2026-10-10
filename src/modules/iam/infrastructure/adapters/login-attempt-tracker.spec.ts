import { FixedClock } from '@shared/domain';

import {
  CONTRACT_LOCKOUT_POLICY,
  loginAttemptTrackerContract,
} from '../../../../../test/contracts/login-attempt-tracker.contract';
import { InMemoryLoginAttemptTracker } from '../../../../../test/fakes/iam';

loginAttemptTrackerContract('InMemoryLoginAttemptTracker', () => {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  return {
    tracker: new InMemoryLoginAttemptTracker(clock, CONTRACT_LOCKOUT_POLICY),
    wait: (ms) => {
      clock.advanceBy(ms);
      return Promise.resolve();
    },
  };
});
