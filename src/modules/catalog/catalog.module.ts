import { Module } from '@nestjs/common';

// Use cases, persistence and adapters of the catalog context. Shared by both processes; the HTTP
// surface lives in CatalogHttpModule, which only the api imports.
@Module({
  providers: [],
  exports: [],
})
export class CatalogModule {}
