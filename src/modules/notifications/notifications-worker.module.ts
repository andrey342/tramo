import { Module } from '@nestjs/common';

import { EmailProcessor, WebhookDeliveryProcessor } from './infrastructure/jobs/notifications-jobs';
import { NotificationsModule } from './notifications.module';

// What only the worker runs for notifications: the processors that send emails and post webhooks.
@Module({
  imports: [NotificationsModule],
  providers: [EmailProcessor, WebhookDeliveryProcessor],
})
export class NotificationsWorkerModule {}
