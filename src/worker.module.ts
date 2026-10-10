import { Module } from '@nestjs/common';

import { CatalogWorkerModule } from '@modules/catalog/catalog-worker.module';
import { OriginationWorkerModule } from '@modules/origination/origination-worker.module';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule } from '@shared/infrastructure/messaging';

// The worker runs queue processors and the outbox publisher. Its only HTTP surface is /health,
// which the container orchestrator probes.
@Module({
  imports: [
    CoreModule.forRoot({ applicationName: 'tramo-worker' }),
    MessagingWorkerModule,
    CatalogWorkerModule,
    OriginationWorkerModule,
  ],
})
export class WorkerModule {}
