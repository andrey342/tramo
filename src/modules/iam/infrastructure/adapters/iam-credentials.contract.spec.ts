import { FixedClock } from '@shared/domain';

import {
  accessTokenIssuerContract,
  credentialGeneratorContract,
  passwordHasherContract,
} from '../../../../../test/contracts/iam-credentials.contract';
import {
  FakeAccessTokenIssuer,
  FakePasswordHasher,
  SequentialCredentialGenerator,
} from '../../../../../test/fakes/iam';

passwordHasherContract('FakePasswordHasher', () => Promise.resolve(new FakePasswordHasher()));
credentialGeneratorContract(
  'SequentialCredentialGenerator',
  () => new SequentialCredentialGenerator(),
);
accessTokenIssuerContract('FakeAccessTokenIssuer', () => {
  const clock = new FixedClock(new Date('2026-10-09T10:00:00Z'));
  return { issuer: new FakeAccessTokenIssuer(clock), clock };
});
