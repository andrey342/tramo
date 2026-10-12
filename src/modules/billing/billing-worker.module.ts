import { Module } from '@nestjs/common';

import { BillingModule } from './billing.module';

// What only the worker runs for billing: processors of the module's own queues.
@Module({
  imports: [BillingModule],
  providers: [],
})
export class BillingWorkerModule {}
