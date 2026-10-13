import { Module } from '@nestjs/common';

import { RebuildProcessor } from './infrastructure/jobs/reporting-jobs';
import { ReportingModule } from './reporting.module';

// What only the worker runs for reporting: the rebuild of the read models.
@Module({
  imports: [ReportingModule],
  providers: [RebuildProcessor],
})
export class ReportingWorkerModule {}
