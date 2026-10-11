import { employmentHistoryProviderContract } from '../../../../../test/contracts/employment-history-provider.contract';
import { FakeEmploymentHistoryProvider } from '../../../../../test/fakes/origination';

import { SimulatedEmploymentHistoryProvider } from './simulated-employment-history-provider';
import { NO_LATENCY } from './simulated-providers';

employmentHistoryProviderContract(
  'FakeEmploymentHistoryProvider',
  () => new FakeEmploymentHistoryProvider(),
);
employmentHistoryProviderContract(
  'SimulatedEmploymentHistoryProvider',
  () => new SimulatedEmploymentHistoryProvider(NO_LATENCY),
);
