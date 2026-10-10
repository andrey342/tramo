import { Module } from '@nestjs/common';

// Use cases, persistence and adapters of the origination context. Shared by both processes; the HTTP
// surface lives in OriginationHttpModule, which only the api imports, and queue processors in
// OriginationWorkerModule, which only the worker imports.
@Module({
  providers: [],
  exports: [],
})
export class OriginationModule {}
