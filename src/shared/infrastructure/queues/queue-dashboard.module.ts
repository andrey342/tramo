import { createHash, timingSafeEqual } from 'node:crypto';

import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { BullBoardModule } from '@bull-board/nestjs';
import { Module } from '@nestjs/common';
import { type NextFunction, type Request, type Response } from 'express';

import { APP_CONFIG, type AppConfig } from '../config';

import { ALL_QUEUES } from './queue-names';

export const QUEUE_DASHBOARD_ROUTE = '/admin/queues';

const digest = (value: string): Buffer => createHash('sha256').update(value).digest();

// Hashing both sides first gives equal-length buffers, so timingSafeEqual can compare credentials
// of any length without leaking it.
export function basicAuth(
  username: string,
  password: string | undefined,
): (req: Request, res: Response, next: NextFunction) => void {
  const expected = password === undefined ? undefined : digest(`${username}:${password}`);
  return (req, res, next) => {
    if (!expected) {
      res.status(404).end();
      return;
    }
    const header = req.headers.authorization ?? '';
    const supplied = header.startsWith('Basic ')
      ? Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8')
      : '';
    if (timingSafeEqual(digest(supplied), expected)) {
      next();
      return;
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="tramo-queues", charset="UTF-8"');
    res.status(401).end();
  };
}

// Served by the api only. Read-write: operations can retry or remove jobs from here.
@Module({
  imports: [
    BullBoardModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        route: QUEUE_DASHBOARD_ROUTE,
        adapter: ExpressAdapter,
        middleware: basicAuth(config.queueDashboard.username, config.queueDashboard.password),
        boardOptions: { uiConfig: { boardTitle: 'Tramo queues' } },
      }),
    }),
    BullBoardModule.forFeature(...ALL_QUEUES.map((name) => ({ name, adapter: BullMQAdapter }))),
  ],
})
export class QueueDashboardModule {}
