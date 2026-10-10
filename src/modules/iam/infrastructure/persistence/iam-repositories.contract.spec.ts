import { iamRepositoriesContract } from '../../../../../test/contracts/iam-repositories.contract';
import {
  InMemoryApiKeyRepository,
  InMemoryRefreshTokenRepository,
  InMemoryUserRepository,
} from '../../../../../test/fakes/iam';
import { InlineUnitOfWork, RecordingEventBus } from '../../../../../test/fakes/shared';

iamRepositoriesContract('in-memory repositories', () => {
  const events = new RecordingEventBus();
  const uow = new InlineUnitOfWork();
  return {
    users: new InMemoryUserRepository(events),
    refreshTokens: new InMemoryRefreshTokenRepository(events),
    apiKeys: new InMemoryApiKeyRepository(events),
    run: (work) => uow.run(work),
  };
});
