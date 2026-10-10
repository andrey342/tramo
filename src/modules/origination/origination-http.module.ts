import { Module } from '@nestjs/common';

import { OriginationModule } from './origination.module';

@Module({
  imports: [OriginationModule],
  controllers: [],
})
export class OriginationHttpModule {}
