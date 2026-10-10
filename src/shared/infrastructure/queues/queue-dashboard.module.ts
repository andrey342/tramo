import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullBoardModule } from '@bull-board/nestjs';
import { Module } from '@nestjs/common';
import { type Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config';
import { REDIS_CLIENT } from '../redis';

import { dashboardAuth } from './dashboard-auth';
import { ALL_QUEUES } from './queue-names';

export const QUEUE_DASHBOARD_ROUTE = '/admin/queues';

// Served by the api only. Read-write: operations can retry or remove jobs from here.
@Module({
  imports: [
    BullBoardModule.forRootAsync({
      inject: [APP_CONFIG, REDIS_CLIENT],
      useFactory: (config: AppConfig, redis: Redis) => ({
        route: QUEUE_DASHBOARD_ROUTE,
        adapter: ExpressAdapter,
        middleware: dashboardAuth({
          username: config.queueDashboard.username,
          password: config.queueDashboard.password,
          redis,
        }),
        boardOptions: { uiConfig: { boardTitle: 'Tramo queues' } },
      }),
    }),
    BullBoardModule.forFeature(...ALL_QUEUES.map((name) => ({ name, adapter: BullMQAdapter }))),
  ],
})
export class QueueDashboardModule {}
