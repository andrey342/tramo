import { Module } from '@nestjs/common';

import { ReportingModule } from './reporting.module';

@Module({
  imports: [ReportingModule],
  controllers: [],
})
export class ReportingHttpModule {}
