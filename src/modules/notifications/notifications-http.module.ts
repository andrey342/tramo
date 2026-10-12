import { Module } from '@nestjs/common';

import { NotificationsModule } from './notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [],
})
export class NotificationsHttpModule {}
