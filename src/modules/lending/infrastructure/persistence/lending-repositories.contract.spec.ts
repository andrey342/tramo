import { lendingRepositoriesContract } from '../../../../../test/contracts/lending-repositories.contract';
import {
  InMemoryContractQueries,
  InMemoryContractRepository,
  InMemoryDisbursementRepository,
  InMemoryFinancingPlanRepository,
} from '../../../../../test/fakes/lending';
import { RecordingEventBus } from '../../../../../test/fakes/shared';

lendingRepositoriesContract('in-memory', () => {
  const events = new RecordingEventBus();
  const contracts = new InMemoryContractRepository(events);
  const disbursements = new InMemoryDisbursementRepository(events);
  const plans = new InMemoryFinancingPlanRepository(events);
  return {
    contracts,
    disbursements,
    plans,
    queries: new InMemoryContractQueries(contracts, disbursements, plans),
    run: (work) => work(),
  };
});
