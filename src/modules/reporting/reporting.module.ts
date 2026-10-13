import { Module } from '@nestjs/common';

// Use cases, persistence and adapters of the reporting context. Shared by both processes; the HTTP
// surface lives in ReportingHttpModule, which only the api imports, and queue processors in
// ReportingWorkerModule, which only the worker imports.
@Module({
  providers: [],
  exports: [],
})
export class ReportingModule {}
