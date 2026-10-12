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
  return {
    contracts,
    disbursements,
    plans: new InMemoryFinancingPlanRepository(events),
    queries: new InMemoryContractQueries(contracts, disbursements),
    run: (work) => work(),
  };
});
