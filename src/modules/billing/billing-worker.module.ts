import { Module } from '@nestjs/common';

import { BillingModule } from './billing.module';
import { SimulatedPspCallbackProcessor } from './infrastructure/adapters/simulated-psp-callbacks';
import {
  BillingCycleProcessor,
  BillingSchedules,
  CollectionProcessor,
  DeclarationReminderProcessor,
  DunningProcessor,
} from './infrastructure/jobs/billing-jobs';

// What only the worker runs for billing: the schedules of the cycle, collection, dunning and the
// declaration reminder, their processors, and the simulated provider's callbacks.
@Module({
  imports: [BillingModule],
  providers: [
    BillingSchedules,
    BillingCycleProcessor,
    CollectionProcessor,
    DunningProcessor,
    DeclarationReminderProcessor,
    SimulatedPspCallbackProcessor,
  ],
})
export class BillingWorkerModule {}
