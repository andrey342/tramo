import { InjectQueue, Processor } from '@nestjs/bullmq';
import { Inject, Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { type Job, type Queue } from 'bullmq';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { type CorrelatedJobData, QueueNames, QueueProcessor } from '@shared/infrastructure/queues';

import { DeliverWebhookCommand } from '../../application/commands/deliver-webhook.command';
import { SendEmailCommand } from '../../application/commands/send-email.command';

export interface EmailJob extends CorrelatedJobData {
  readonly notificationId: string;
}

export interface WebhookJob extends CorrelatedJobData {
  readonly deliveryId: string;
  readonly round: number;
}

// An SMTP server down for a while: five attempts over about five minutes, then the email is
// given up (failed in the notification log) and the job dead-lettered.
const EMAIL_ATTEMPTS = 5;
const EMAIL_BACKOFF_MS = 20_000;
// Five attempts per round, the delay doubling from WEBHOOK_RETRY_DELAY_MS (30 s by default:
// about 7.5 minutes for the round), then the delivery fails and the job is dead-lettered.
export const WEBHOOK_ATTEMPTS = 5;

const lastAttempt = (job: Job): boolean => job.attemptsMade + 1 >= (job.opts.attempts ?? 1);

// One job per notification: a redelivered EmailRequested queues nothing new.
@Injectable()
export class EmailJobs {
  constructor(@InjectQueue(QueueNames.EMAILS) private readonly queue: Queue<EmailJob>) {}

  async send(notificationId: string, correlationId: string | null): Promise<void> {
    await this.queue.add(
      'email.send',
      { notificationId, correlationId },
      {
        jobId: `${notificationId}.send`,
        attempts: EMAIL_ATTEMPTS,
        backoff: { type: 'exponential', delay: EMAIL_BACKOFF_MS },
      },
    );
  }
}

// One job per delivery and round: a redelivery is a new round, so a new job.
@Injectable()
export class WebhookJobs {
  constructor(
    @InjectQueue(QueueNames.WEBHOOK_DELIVERIES) private readonly queue: Queue<WebhookJob>,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async deliver(deliveryId: string, round: number, correlationId: string | null): Promise<void> {
    await this.queue.add(
      'webhook.deliver',
      { deliveryId, round, correlationId },
      {
        jobId: `${deliveryId}.r${String(round)}`,
        attempts: WEBHOOK_ATTEMPTS,
        backoff: { type: 'exponential', delay: this.config.notifications.webhooks.retryDelayMs },
      },
    );
  }
}

@Processor(QueueNames.EMAILS, { concurrency: 5 })
export class EmailProcessor extends QueueProcessor<EmailJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected handle(job: Job<EmailJob>): Promise<unknown> {
    return this.commands.execute(new SendEmailCommand(job.data.notificationId, lastAttempt(job)));
  }
}

@Processor(QueueNames.WEBHOOK_DELIVERIES, { concurrency: 10 })
export class WebhookDeliveryProcessor extends QueueProcessor<WebhookJob> {
  constructor(private readonly commands: CommandBus) {
    super();
  }

  protected handle(job: Job<WebhookJob>): Promise<unknown> {
    return this.commands.execute(
      new DeliverWebhookCommand(job.data.deliveryId, job.data.round, lastAttempt(job)),
    );
  }
}
