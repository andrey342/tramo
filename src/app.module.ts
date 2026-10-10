import { Module } from '@nestjs/common';

import { CatalogHttpModule } from '@modules/catalog/catalog-http.module';
import { IamHttpModule } from '@modules/iam/iam-http.module';
import { CoreModule } from '@shared/infrastructure/core.module';
import { HttpPlatformModule } from '@shared/infrastructure/http';
import { QueueDashboardModule } from '@shared/infrastructure/queues/queue-dashboard.module';

@Module({
  imports: [
    CoreModule.forRoot({ applicationName: 'tramo-api' }),
    HttpPlatformModule,
    QueueDashboardModule,
    IamHttpModule,
    CatalogHttpModule,
  ],
})
export class AppModule {}
