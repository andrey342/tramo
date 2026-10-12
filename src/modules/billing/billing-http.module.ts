import { Module } from '@nestjs/common';

import { BillingModule } from './billing.module';
import { BillingController } from './infrastructure/http/billing.controller';
import { PspWebhookController } from './infrastructure/http/psp-webhook.controller';

@Module({
  imports: [BillingModule],
  controllers: [BillingController, PspWebhookController],
})
export class BillingHttpModule {}
