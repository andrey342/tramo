import { Module } from '@nestjs/common';

import { WebhooksController } from './infrastructure/http/webhooks.controller';
import { NotificationsModule } from './notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [WebhooksController],
})
export class NotificationsHttpModule {}
