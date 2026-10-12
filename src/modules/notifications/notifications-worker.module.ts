import { Module } from '@nestjs/common';

import { NotificationsModule } from './notifications.module';

// What only the worker runs for notifications: processors of the module's own queues.
@Module({
  imports: [NotificationsModule],
  providers: [],
})
export class NotificationsWorkerModule {}
