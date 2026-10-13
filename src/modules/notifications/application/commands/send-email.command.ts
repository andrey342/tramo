import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import { EMAIL_NOTIFICATION_REPOSITORY, type EmailNotificationRepository } from '../../domain';
import {
  EMAIL_RENDERER,
  EMAIL_SENDER,
  EmailSendFailedError,
  type EmailRenderer,
  type EmailSender,
} from '../ports/notifications-ports';

// The mail server did not take it; the job retries it (or, on its last attempt, gives up).
// Carries the category only: the server's text quotes the recipient.
export class EmailNotSentError extends Error {
  constructor(
    readonly notificationId: string,
    readonly reason: string,
  ) {
    super(`Email ${notificationId} not sent: ${reason}`);
    this.name = 'EmailNotSentError';
  }
}

// Sends one email of the notification log, by its job: rendered from its template and the values
// recorded with it. A sent or failed one is not sent again. When the job's last attempt fails
// before the send (the database), the email is given up anyway.
export class SendEmailCommand extends Command<'sent' | 'skipped'> {
  constructor(
    readonly notificationId: string,
    readonly lastAttempt: boolean,
  ) {
    super();
  }
}

@CommandHandler(SendEmailCommand)
export class SendEmailHandler implements ICommandHandler<SendEmailCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EMAIL_NOTIFICATION_REPOSITORY)
    private readonly notifications: EmailNotificationRepository,
    @Inject(EMAIL_RENDERER) private readonly renderer: EmailRenderer,
    @Inject(EMAIL_SENDER) private readonly sender: EmailSender,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: SendEmailCommand): Promise<'sent' | 'skipped'> {
    try {
      return await this.send(command);
    } catch (error) {
      if (command.lastAttempt && !(error instanceof EmailNotSentError)) {
        await this.record(command, 'internal_error').catch(() => undefined);
      }
      throw error;
    }
  }

  private async send(command: SendEmailCommand): Promise<'sent' | 'skipped'> {
    const notification = await this.notifications.findById(command.notificationId);
    if (!notification?.pending) {
      return 'skipped';
    }
    let error: string | null = null;
    try {
      const rendered = this.renderer.render(
        notification.template,
        notification.data,
        notification.reference,
      );
      await this.sender.send({
        ...rendered,
        to: notification.recipient.value,
        reference: notification.reference,
      });
    } catch (cause) {
      error = cause instanceof EmailSendFailedError ? cause.code : 'send_failed';
    }
    await this.record(command, error);
    if (error !== null) {
      throw new EmailNotSentError(command.notificationId, error);
    }
    return 'sent';
  }

  private async record(command: SendEmailCommand, error: string | null): Promise<void> {
    await this.uow.run(async () => {
      const current = await this.notifications.findById(command.notificationId);
      if (!current) {
        return;
      }
      if (error === null) {
        current.markSent(this.clock.now());
      } else {
        current.recordFailedAttempt(error);
        if (command.lastAttempt) {
          current.giveUp(this.clock.now());
        }
      }
      await this.notifications.save(current);
    });
  }
}
