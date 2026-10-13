import { Module } from '@nestjs/common';

import { BillingWorkerModule } from '@modules/billing/billing-worker.module';
import { CatalogWorkerModule } from '@modules/catalog/catalog-worker.module';
import { IamModule } from '@modules/iam/iam.module';
import { LendingWorkerModule } from '@modules/lending/lending-worker.module';
import { NotificationsWorkerModule } from '@modules/notifications/notifications-worker.module';
import { OriginationWorkerModule } from '@modules/origination/origination-worker.module';
import { ReportingWorkerModule } from '@modules/reporting/reporting-worker.module';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule } from '@shared/infrastructure/messaging';

// The worker runs queue processors and the outbox publisher. Its only HTTP surface is /health,
// which the container orchestrator probes.
@Module({
  imports: [
    CoreModule.forRoot({ applicationName: 'tramo-worker' }),
    MessagingWorkerModule,
    // No queues of its own; its public queries answer consumers (where to email a user).
    IamModule,
    CatalogWorkerModule,
    OriginationWorkerModule,
    LendingWorkerModule,
    BillingWorkerModule,
    NotificationsWorkerModule,
    ReportingWorkerModule,
  ],
})
export class WorkerModule {}
