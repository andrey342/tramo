import { Inject } from '@nestjs/common';
import { Command, CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { uuidv7 } from 'uuidv7';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CLOCK, type Clock, Email, type JsonValue } from '@shared/domain';

import {
  EMAIL_NOTIFICATION_REPOSITORY,
  EmailNotification,
  type EmailNotificationRepository,
  type EmailTemplate,
} from '../../domain';
import { RECIPIENTS, type Recipients } from '../ports/notifications-ports';

// Who an email goes to: a user (looked up in iam), the admins of a center, or an address the
// event carries (the welcome email, sent before anything else knows the user).
export type EmailRecipient =
  { readonly userId: string } | { readonly centerId: string } | { readonly address: string };

export interface EmailRequest {
  readonly eventId: string;
  readonly template: EmailTemplate;
  readonly to: EmailRecipient;
  readonly reference: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

// An event calls for an email: one notification per recipient is written down, once per event,
// and a job sends each. Nobody to write to (a disabled user, a center without admins) writes
// nothing. Returns how many were written.
export class RequestEmailCommand extends Command<number> {
  constructor(readonly request: EmailRequest) {
    super();
  }
}

@CommandHandler(RequestEmailCommand)
export class RequestEmailHandler implements ICommandHandler<RequestEmailCommand> {
  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(EMAIL_NOTIFICATION_REPOSITORY)
    private readonly notifications: EmailNotificationRepository,
    @Inject(RECIPIENTS) private readonly recipients: Recipients,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(command: RequestEmailCommand): Promise<number> {
    const { request } = command;
    const addresses = await this.addresses(request.to);
    return this.uow.run(async () => {
      let written = 0;
      for (const raw of addresses) {
        const address = Email.create(raw);
        if (
          !address.ok ||
          (await this.notifications.exists(request.eventId, request.template, address.value.value))
        ) {
          continue;
        }
        await this.notifications.save(
          EmailNotification.request({
            id: uuidv7(),
            eventId: request.eventId,
            template: request.template,
            recipient: address.value,
            reference: request.reference,
            data: request.data,
            now: this.clock.now(),
          }),
        );
        written += 1;
      }
      return written;
    });
  }

  private async addresses(to: EmailRecipient): Promise<readonly string[]> {
    if ('address' in to) {
      return [to.address];
    }
    if ('userId' in to) {
      const address = await this.recipients.userEmail(to.userId);
      return address ? [address] : [];
    }
    return this.recipients.centerContacts(to.centerId);
  }
}
