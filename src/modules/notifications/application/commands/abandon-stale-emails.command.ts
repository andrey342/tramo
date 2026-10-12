import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock } from '@shared/domain';

import {
  EMAIL_NOTIFICATION_REPOSITORY,
  type EmailNotificationRepository,
  STALE_EMAIL_MS,
} from '../../domain';

const PAGE = 200;

// The hourly sweep: emails still pending a day after they were written lost their job; they are
// given up (failed in the notification log) so nothing waits on them and nobody receives a
// reminder a day late. Returns how many.
export class AbandonStaleEmailsCommand extends Command<number> {}

@CommandHandler(AbandonStaleEmailsCommand)
export class AbandonStaleEmailsHandler implements ICommandHandler<AbandonStaleEmailsCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EMAIL_NOTIFICATION_REPOSITORY)
    private readonly notifications: EmailNotificationRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(): Promise<number> {
    const now = this.clock.now();
    const before = new Date(now.getTime() - STALE_EMAIL_MS);
    let abandoned = 0;
    for (;;) {
      const ids = await this.notifications.findPendingIds(before, PAGE);
      for (const id of ids) {
        await this.uow.run(async () => {
          const notification = await this.notifications.findById(id);
          if (notification?.isStale(now)) {
            notification.abandon(now);
            await this.notifications.save(notification);
            abandoned += 1;
          }
        });
      }
      if (ids.length < PAGE) {
        return abandoned;
      }
    }
  }
}
