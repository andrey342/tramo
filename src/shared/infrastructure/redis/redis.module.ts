import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Redis } from 'ioredis';

import { APP_CONFIG, type AppConfig } from '../config';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => {
        const client = new Redis(config.redis.url, {
          connectionName: 'tramo',
          maxRetriesPerRequest: 3,
        });
        // Without a listener ioredis prints raw "Unhandled error event" lines outside the logger.
        // Reconnection is automatic; readiness reports the outage.
        const logger = new Logger('Redis');
        client.on('error', (error: Error) => {
          logger.warn({ err: error.message }, 'Redis connection error');
        });
        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onApplicationShutdown(): Promise<void> {
    // QUIT is queued until the connection is up, so only use it on a ready client; otherwise
    // drop the socket and stop reconnecting, or shutdown would wait for Redis to come back.
    if (this.redis.status === 'ready') {
      await this.redis.quit();
    } else {
      this.redis.disconnect(false);
    }
  }
}
