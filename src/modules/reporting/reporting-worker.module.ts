import { Module } from '@nestjs/common';

import { ReportingModule } from './reporting.module';

// What only the worker runs for reporting: processors of the module's own queues.
@Module({
  imports: [ReportingModule],
  providers: [],
})
export class ReportingWorkerModule {}
