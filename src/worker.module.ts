import { Module } from '@nestjs/common';

import { CoreModule } from '@shared/infrastructure/core.module';

// The worker runs queue processors and the outbox publisher. Its only HTTP surface is /health,
// which the container orchestrator probes.
@Module({
  imports: [CoreModule.forRoot({ applicationName: 'tramo-worker' })],
})
export class WorkerModule {}
