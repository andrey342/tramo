import { Module } from '@nestjs/common';

import { ConfigModule } from '@shared/infrastructure/config';
import { LoggingModule } from '@shared/infrastructure/logging';

@Module({
  imports: [ConfigModule, LoggingModule],
})
export class AppModule {}
