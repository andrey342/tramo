import { originationRepositoriesContract } from '../../../../../test/contracts/origination-repositories.contract';
import { NOW } from '../../../../../test/factories/origination';
import {
  InMemoryApplicationQueries,
  InMemoryFinancingApplicationRepository,
  InMemoryRiskPolicyRepository,
} from '../../../../../test/fakes/origination';
import { RecordingEventBus } from '../../../../../test/fakes/shared';
import { RiskPolicy } from '../../domain';

originationRepositoriesContract('in-memory', () => {
  const applications = new InMemoryFinancingApplicationRepository(new RecordingEventBus());
  return {
    applications,
    policies: new InMemoryRiskPolicyRepository([RiskPolicy.initial(NOW)]),
    queries: new InMemoryApplicationQueries(applications),
    run: (work) => work(),
  };
});
