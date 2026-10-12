import { Module } from '@nestjs/common';

// Use cases, persistence and adapters of the lending context. Shared by both processes; the HTTP
// surface lives in LendingHttpModule, which only the api imports, and queue processors in
// LendingWorkerModule, which only the worker imports.
@Module({
  providers: [],
  exports: [],
})
export class LendingModule {}
