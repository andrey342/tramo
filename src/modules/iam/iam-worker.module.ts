import { Module } from '@nestjs/common';

import { IamModule } from './iam.module';
import { SessionSweepProcessor, SessionSweepSchedule } from './infrastructure/jobs/session-sweep';

// What only the worker runs for iam: the daily sweep of ended sessions. Through IamModule, its
// public queries also answer other modules' consumers (where to email a user).
@Module({
  imports: [IamModule],
  providers: [SessionSweepSchedule, SessionSweepProcessor],
})
export class IamWorkerModule {}
