import { Module } from '@nestjs/common';

import { ConfigModule } from '@shared/infrastructure/config';
import { DatabaseModule } from '@shared/infrastructure/database';
import { HealthModule } from '@shared/infrastructure/health';
import { HttpPlatformModule } from '@shared/infrastructure/http';
import { LoggingModule } from '@shared/infrastructure/logging';
import { RedisModule } from '@shared/infrastructure/redis';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    DatabaseModule.forRoot('tramo-api'),
    RedisModule,
    HttpPlatformModule,
    HealthModule,
  ],
})
export class AppModule {}
