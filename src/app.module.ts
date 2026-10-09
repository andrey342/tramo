import { Module } from '@nestjs/common';

import { ConfigModule } from '@shared/infrastructure/config';
import { HttpPlatformModule } from '@shared/infrastructure/http';
import { LoggingModule } from '@shared/infrastructure/logging';

@Module({
  imports: [ConfigModule, LoggingModule, HttpPlatformModule],
})
export class AppModule {}
