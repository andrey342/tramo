import { Module } from '@nestjs/common';

import { CoreModule } from '@shared/infrastructure/core.module';
import { HttpPlatformModule } from '@shared/infrastructure/http';

@Module({
  imports: [CoreModule.forRoot({ applicationName: 'tramo-api' }), HttpPlatformModule],
})
export class AppModule {}
