import { Module } from '@nestjs/common';

// Use cases, persistence and adapters of the billing context. Shared by both processes; the HTTP
// surface lives in BillingHttpModule, which only the api imports, and queue processors in
// BillingWorkerModule, which only the worker imports.
@Module({
  providers: [],
  exports: [],
})
export class BillingModule {}
