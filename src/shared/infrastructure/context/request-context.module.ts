import { type ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';

import { resolveRequestId } from './request-id';

// Async-local context per request (and per job in the worker). Its id is the request id, so logs,
// outbox rows and jobs started by a request share one correlation id.
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Parameters<typeof resolveRequestId>[0] & { res?: ServerResponse }) =>
          resolveRequestId(req, req.res),
      },
    }),
  ],
})
export class RequestContextModule {}
