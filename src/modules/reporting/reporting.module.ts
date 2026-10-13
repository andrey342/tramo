import { Module } from '@nestjs/common';

import { ProjectEventHandler } from './application/commands/project-event.command';
import { RebuildProjectionsHandler } from './application/commands/rebuild-projections.command';
import { RequestRebuildHandler } from './application/commands/request-rebuild.command';
import {
  PROGRAM_SCORES,
  PROGRAMS,
  QUEUE_HEALTH,
  REBUILD_JOBS,
  REPORTING_STORE,
} from './application/ports/reporting-ports';
import { GetCenterDashboardHandler } from './application/queries/get-center-dashboard.query';
import { GetOpsOverviewHandler } from './application/queries/get-ops-overview.query';
import { GetProgramPerformanceHandler } from './application/queries/get-program-performance.query';
import { ReportingProjector } from './application/reporting-projector';
import {
  BullQueueHealth,
  CatalogPrograms,
  OriginationProgramScores,
} from './infrastructure/adapters/reporting-lookups';
import { REPORTING_CONSUMERS } from './infrastructure/consumers/reporting.consumers';
import { QueuedRebuildJobs } from './infrastructure/jobs/reporting-jobs';
import { TypeOrmReportingStore } from './infrastructure/persistence/typeorm-reporting.store';

// Use cases, persistence and adapters of the reporting context. Shared by both processes; the HTTP
// surface lives in ReportingHttpModule, which only the api imports, and queue processors in
// ReportingWorkerModule, which only the worker imports.
@Module({
  providers: [
    { provide: REPORTING_STORE, useClass: TypeOrmReportingStore },
    { provide: PROGRAMS, useClass: CatalogPrograms },
    { provide: PROGRAM_SCORES, useClass: OriginationProgramScores },
    { provide: QUEUE_HEALTH, useClass: BullQueueHealth },
    { provide: REBUILD_JOBS, useClass: QueuedRebuildJobs },
    ReportingProjector,
    ProjectEventHandler,
    RebuildProjectionsHandler,
    RequestRebuildHandler,
    GetCenterDashboardHandler,
    GetProgramPerformanceHandler,
    GetOpsOverviewHandler,
    ...REPORTING_CONSUMERS,
  ],
  exports: [],
})
export class ReportingModule {}
