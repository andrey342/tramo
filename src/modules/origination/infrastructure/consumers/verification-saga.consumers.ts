import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { ScoreApplicationCommand } from '../../application/commands/score-application.command';
import {
  type ApplicationSubmittedPayload,
  OriginationEvents,
  type VerificationCompletedPayload,
} from '../../domain';
import { VerificationJobs } from '../jobs/verifications';

// The verification saga, step 1: the three checks of a submitted application are queued (KYC,
// employment history, credit bureau); the first answer marks it as being verified. Nothing is
// written here, so no database row is held while Redis is called, and queueing is idempotent by
// job id: a redelivered event changes nothing.
@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationSubmitted,
  consumer: 'origination.start-verification',
})
export class StartVerificationOnSubmit implements EventHandler<ApplicationSubmittedPayload> {
  constructor(private readonly jobs: VerificationJobs) {}

  async handle(event: IntegrationEvent<ApplicationSubmittedPayload>): Promise<void> {
    await this.jobs.queueAll(event.payload.applicationId, event.correlationId);
  }
}

// Step 2: every answer is announced; only the one that completes the set (nothing remaining)
// scores the application. ScoreApplication is a no-op if it is no longer waiting for its score.
@Injectable()
@EventSubscriber({
  event: OriginationEvents.VerificationCompleted,
  consumer: 'origination.score-application',
})
export class ScoreWhenVerified implements EventHandler<VerificationCompletedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<VerificationCompletedPayload>): Promise<void> {
    if (event.payload.remaining === 0) {
      await this.commands.execute(new ScoreApplicationCommand(event.payload.applicationId));
    }
  }
}
