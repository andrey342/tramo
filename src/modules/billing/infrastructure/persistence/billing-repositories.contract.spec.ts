import { billingRepositoriesContract } from '../../../../../test/contracts/billing-repositories.contract';
import {
  InMemoryBillingQueries,
  InMemoryChargeRepository,
  InMemoryIncomeDeclarationRepository,
  InMemoryPaymentMandateRepository,
} from '../../../../../test/fakes/billing';
import { RecordingEventBus } from '../../../../../test/fakes/shared';

billingRepositoriesContract('in-memory', () => {
  const events = new RecordingEventBus();
  const charges = new InMemoryChargeRepository(events);
  return {
    charges,
    mandates: new InMemoryPaymentMandateRepository(events),
    declarations: new InMemoryIncomeDeclarationRepository(events),
    queries: new InMemoryBillingQueries(charges),
    run: (work) => work(),
  };
});
