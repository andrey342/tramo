import { Module } from '@nestjs/common';
import { ClsServiceManager } from 'nestjs-cls';
import { LoggerModule } from 'nestjs-pino';

import { APP_CONFIG, type AppConfig } from '../config';
import { resolveRequestId } from '../context';

import { censor, REDACTED_PATHS } from './redaction';

const QUIET_PATHS = ['/health', '/metrics'];

// Every log line carries the CLS id: the request id over HTTP, the correlation id inside jobs.
function correlationMixin(): Record<string, string> {
  const cls = ClsServiceManager.getClsService();
  const id: unknown = cls.isActive() ? cls.getId() : undefined;
  return typeof id === 'string' ? { correlationId: id } : {};
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({
        pinoHttp: {
          level: config.log.level,
          genReqId: resolveRequestId,
          mixin: correlationMixin,
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
