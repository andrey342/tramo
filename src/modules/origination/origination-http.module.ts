import { Module } from '@nestjs/common';

import { ApplicationsController } from './infrastructure/http/applications.controller';
import { OpsApplicationsController } from './infrastructure/http/ops-applications.controller';
import { OriginationModule } from './origination.module';

@Module({
  imports: [OriginationModule],
  controllers: [ApplicationsController, OpsApplicationsController],
})
export class OriginationHttpModule {}
