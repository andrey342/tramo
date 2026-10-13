import { Inject, Logger } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, ConcurrentModificationError } from '@shared/domain';

import {
  EMAIL_NOTIFICATION_REPOSITORY,
  type EmailNotificationRepository,
  type PendingEmail,
} from '../../domain';

const PAGE = 200;

export interface AbandonedEmailsDto {
  readonly abandoned: number;
  // Emails that could not be given up for another reason than a concurrent send; the job fails
  // with them so they show among failed jobs.
  readonly failedIds: readonly string[];
}

// The hourly sweep: emails still pending a day after they were written lost their job; they are
// given up (failed in the notification log) so nothing waits on them and nobody receives a
// reminder a day late. One email per transaction, walking past those that cannot be given up.
export class AbandonStaleEmailsCommand extends Command<AbandonedEmailsDto> {}

@CommandHandler(AbandonStaleEmailsCommand)
export class AbandonStaleEmailsHandler implements ICommandHandler<AbandonStaleEmailsCommand> {
  private readonly logger = new Logger(AbandonStaleEmailsHandler.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EMAIL_NOTIFICATION_REPOSITORY)
    private readonly notifications: EmailNotificationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(): Promise<AbandonedEmailsDto> {
    const now = this.clock.now();
    let abandoned = 0;
    const failedIds: string[] = [];
    let after: PendingEmail | null = null;
    for (;;) {
      const page = await this.notifications.findStale(now, PAGE, after);
      for (const { id } of page) {
        try {
          abandoned += (await this.abandon(id, now)) ? 1 : 0;
        } catch (error) {
          // Sent meanwhile: nothing to give up.
          if (error instanceof ConcurrentModificationError) continue;
          failedIds.push(id);
          this.logger.error({ notificationId: id, err: error }, 'Stale email not given up');
        }
      }
      if (page.length < PAGE) {
        return { abandoned, failedIds };
      }
      after = page.at(-1) ?? null;
    }
  }

  private abandon(id: string, now: Date): Promise<boolean> {
    return this.uow.run(async () => {
      const notification = await this.notifications.findById(id);
      if (!notification?.isStale(now)) {
        return false;
      }
      notification.abandon(now);
      await this.notifications.save(notification);
      return true;
    });
  }
}
