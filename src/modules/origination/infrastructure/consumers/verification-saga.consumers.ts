import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';

import { type EventHandler, EventSubscriber, type IntegrationEvent } from '@shared/application';

import { ScoreApplicationCommand } from '../../application/commands/score-application.command';
import { StartVerificationCommand } from '../../application/commands/start-verification.command';
import {
  type ApplicationSubmittedPayload,
  OriginationEvents,
  type VerificationCompletedPayload,
} from '../../domain';
import { VerificationJobs } from '../jobs/verifications';

// The verification saga, step 1: a submitted application is marked as being verified and its
// three checks are queued (KYC, employment history, credit bureau). Queueing is idempotent by job
// id, so a redelivered event changes nothing.
@Injectable()
@EventSubscriber({
  event: OriginationEvents.ApplicationSubmitted,
  consumer: 'origination.start-verification',
})
export class StartVerificationOnSubmit implements EventHandler<ApplicationSubmittedPayload> {
  constructor(
    private readonly commands: CommandBus,
    private readonly jobs: VerificationJobs,
  ) {}

  async handle(event: IntegrationEvent<ApplicationSubmittedPayload>): Promise<void> {
    await this.commands.execute(new StartVerificationCommand(event.payload.applicationId));
    await this.jobs.queueAll(event.payload.applicationId, event.correlationId);
  }
}

// Step 2: every answer is announced; the one that completes the set has moved the application to
// scoring, and scoring it is a no-op for the other two.
@Injectable()
@EventSubscriber({
  event: OriginationEvents.VerificationCompleted,
  consumer: 'origination.score-application',
})
export class ScoreWhenVerified implements EventHandler<VerificationCompletedPayload> {
  constructor(private readonly commands: CommandBus) {}

  async handle(event: IntegrationEvent<VerificationCompletedPayload>): Promise<void> {
    await this.commands.execute(new ScoreApplicationCommand(event.payload.applicationId));
  }
}
