import { Module } from '@nestjs/common';

import { ReportingController } from './infrastructure/http/reporting.controller';
import { ReportingModule } from './reporting.module';

@Module({
  imports: [ReportingModule],
  controllers: [ReportingController],
})
export class ReportingHttpModule {}
