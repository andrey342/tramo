import { Module } from '@nestjs/common';

import { DisbursementProcessor, SignatureProcessor } from './infrastructure/jobs/lending-jobs';
import { LendingModule } from './lending.module';

// What only the worker runs for lending: processors of the module's own queues.
@Module({
  imports: [LendingModule],
  providers: [SignatureProcessor, DisbursementProcessor],
})
export class LendingWorkerModule {}
