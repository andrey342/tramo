import { type IncomingMessage, type ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { uuidv7 } from 'uuidv7';

import { APP_CONFIG, type AppConfig } from '../config';
import { censor, REDACTED_PATHS } from './redaction';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[\w.-]{1,128}$/;
const QUIET_PATHS = ['/health', '/metrics'];

function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : uuidv7();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.log.level,
          genReqId: resolveRequestId,
          redact: { paths: [...REDACTED_PATHS], censor },
          autoLogging: {
            ignore: (req) => QUIET_PATHS.some((path) => req.url?.startsWith(path) === true),
          },
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          transport: config.log.pretty
            ? {
                target: 'pino-pretty',
                options: { singleLine: true, translateTime: 'SYS:HH:MM:ss' },
              }
            : undefined,
        },
      }),
    }),
  ],
})
export class LoggingModule {}
