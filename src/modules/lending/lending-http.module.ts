import { Module } from '@nestjs/common';

import { ContractsController } from './infrastructure/http/contracts.controller';
import { ESignatureWebhookController } from './infrastructure/http/esignature-webhook.controller';
import { OpsDisbursementsController } from './infrastructure/http/ops-disbursements.controller';
import { LendingModule } from './lending.module';

@Module({
  imports: [LendingModule],
  controllers: [ContractsController, OpsDisbursementsController, ESignatureWebhookController],
})
export class LendingHttpModule {}
