import { Module } from '@nestjs/common';

import { CoreModule } from '@shared/infrastructure/core.module';
import { HttpPlatformModule } from '@shared/infrastructure/http';
import { QueueDashboardModule } from '@shared/infrastructure/queues/queue-dashboard.module';

@Module({
  imports: [
    CoreModule.forRoot({ applicationName: 'tramo-api' }),
    HttpPlatformModule,
    QueueDashboardModule,
  ],
})
export class AppModule {}
