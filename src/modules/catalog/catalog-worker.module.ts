import { Module } from '@nestjs/common';

import { CatalogModule } from './catalog.module';
import { VatCheckProcessor } from './infrastructure/jobs/vat-checks';

// What only the worker runs for the catalog: processors of the module's own queues.
@Module({
  imports: [CatalogModule],
  providers: [VatCheckProcessor],
})
export class CatalogWorkerModule {}
