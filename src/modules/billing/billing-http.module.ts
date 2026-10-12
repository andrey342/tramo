import { Module } from '@nestjs/common';

import { BillingModule } from './billing.module';

@Module({
  imports: [BillingModule],
  controllers: [],
})
export class BillingHttpModule {}
