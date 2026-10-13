import { Module } from '@nestjs/common';

import {
  EmailProcessor,
  NotificationSchedules,
  WebhookDeliveryProcessor,
} from './infrastructure/jobs/notifications-jobs';
import { NotificationsModule } from './notifications.module';

// What only the worker runs for notifications: the processors that send emails and post
// webhooks, and the hourly sweep of emails whose job was lost.
@Module({
  imports: [NotificationsModule],
  providers: [NotificationSchedules, EmailProcessor, WebhookDeliveryProcessor],
})
export class NotificationsWorkerModule {}
