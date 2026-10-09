import { Module } from '@nestjs/common';

import { ConfigModule } from '@shared/infrastructure/config';
import { DatabaseModule } from '@shared/infrastructure/database';
import { HealthModule } from '@shared/infrastructure/health';
import { LoggingModule } from '@shared/infrastructure/logging';
import { RedisModule } from '@shared/infrastructure/redis';

// The worker runs queue processors and the outbox publisher. Its only HTTP surface is /health,
// which the container orchestrator probes.
@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule.forRoot('tramo-worker'),
    RedisModule,
    HealthModule,
  ],
})
export class WorkerModule {}
