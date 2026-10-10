import { Module } from '@nestjs/common';

import { OriginationModule } from './origination.module';

// What only the worker runs for origination: processors of the module's own queues.
@Module({
  imports: [OriginationModule],
  providers: [],
})
export class OriginationWorkerModule {}
