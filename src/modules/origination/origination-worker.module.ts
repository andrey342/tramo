import { Module } from '@nestjs/common';

import {
  ApplicationExpiryProcessor,
  ApplicationExpirySchedule,
} from './infrastructure/jobs/application-expiry';
import { VerificationProcessor } from './infrastructure/jobs/verifications';
import { OriginationModule } from './origination.module';

// What only the worker runs for origination: processors of the module's own queues and the
// schedule of the expiry sweep.
@Module({
  imports: [OriginationModule],
  providers: [VerificationProcessor, ApplicationExpiryProcessor, ApplicationExpirySchedule],
})
export class OriginationWorkerModule {}
