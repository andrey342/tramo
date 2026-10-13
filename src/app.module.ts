import { Module } from '@nestjs/common';

import { BillingHttpModule } from '@modules/billing/billing-http.module';
import { CatalogHttpModule } from '@modules/catalog/catalog-http.module';
import { IamHttpModule } from '@modules/iam/iam-http.module';
import { LendingHttpModule } from '@modules/lending/lending-http.module';
import { NotificationsHttpModule } from '@modules/notifications/notifications-http.module';
import { OriginationHttpModule } from '@modules/origination/origination-http.module';
import { ReportingHttpModule } from '@modules/reporting/reporting-http.module';
import { CoreModule } from '@shared/infrastructure/core.module';
import { HttpPlatformModule } from '@shared/infrastructure/http';
import { MetricsModule } from '@shared/infrastructure/metrics';
import { QueueDashboardModule } from '@shared/infrastructure/queues/queue-dashboard.module';

@Module({
  imports: [
    CoreModule.forRoot({ applicationName: 'tramo-api' }),
    HttpPlatformModule,
    MetricsModule,
    QueueDashboardModule,
    IamHttpModule,
    CatalogHttpModule,
    OriginationHttpModule,
    LendingHttpModule,
    BillingHttpModule,
    NotificationsHttpModule,
    ReportingHttpModule,
  ],
})
export class AppModule {}
