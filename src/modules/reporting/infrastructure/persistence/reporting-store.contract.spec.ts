import { reportingStoreContract } from '../../../../../test/contracts/reporting-store.contract';
import { InMemoryReportingStore } from '../../../../../test/fakes/reporting';

reportingStoreContract('in-memory', () => ({
  store: new InMemoryReportingStore(),
  run: (work) => work(),
}));
