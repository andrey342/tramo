import { AggregateRoot, type Email, type JsonValue } from '@shared/domain';

import { NotificationsEvents } from '../events/notifications-events';

export const EMAIL_TEMPLATES = [
  'welcome',
  'application_received',
  'application_decided',
  'contract_ready_to_sign',
  'disbursement_settled',
  'installment_reminder',
  'installment_collected',
  'payment_overdue',
  'contract_in_arrears',
  'isa_declaration_reminder',
  'isa_declaration_overdue',
  'payment_returned',
] as const;
export type EmailTemplate = (typeof EMAIL_TEMPLATES)[number];

export type EmailStatus = 'pending' | 'sent' | 'failed';

const MAX_ERROR_LENGTH = 100;
// A pending email whose job never finished (dead-lettered after an outage, lost) is given up
// after this long rather than sent a day late.
export const STALE_EMAIL_MS = 24 * 60 * 60 * 1000;

// Emails written at or before this instant are stale at `now`, if still pending.
export const staleBefore = (now: Date): Date => new Date(now.getTime() - STALE_EMAIL_MS);

export interface EmailNotificationProps {
  // The event that caused it: one email per event, template and recipient.
  readonly eventId: string;
  readonly template: EmailTemplate;
  readonly recipient: Email;
  // The id of what it is about (an application, a contract), quoted in the email so a support
  // search finds it.
  readonly reference: string;
  // The template's values: ids, amounts and dates, never secrets.
  readonly data: Readonly<Record<string, JsonValue>>;
  readonly status: EmailStatus;
  readonly attempts: number;
  // A category (`smtp_550`, `timeout`, `connection_failed`), never the server's text, which
  // quotes the recipient.
  readonly lastError: string | null;
  readonly sentAt: Date | null;
  readonly createdAt: Date;
}

// An email Tramo owes someone: written down with the event that caused it, then sent by a job
// (the notification log). Sending is at least once: an SMTP answer lost after the server took
// the message sends it again.
export class EmailNotification extends AggregateRoot {
  private constructor(
    id: string,
    private props: EmailNotificationProps,
  ) {
    super(id);
  }

  static request(input: {
    id: string;
    eventId: string;
    template: EmailTemplate;
    recipient: Email;
    reference: string;
    data: Readonly<Record<string, JsonValue>>;
    now: Date;
  }): EmailNotification {
    const notification = new EmailNotification(input.id, {
      eventId: input.eventId,
      template: input.template,
      recipient: input.recipient,
      reference: input.reference,
      data: input.data,
      status: 'pending',
      attempts: 0,
      lastError: null,
      sentAt: null,
      createdAt: input.now,
    });
    notification.record({
      eventType: NotificationsEvents.EmailRequested,
      aggregateType: 'EmailNotification',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        notificationId: input.id,
        template: input.template,
        reference: input.reference,
      },
    });
    return notification;
  }

  static reconstitute(id: string, props: EmailNotificationProps): EmailNotification {
    return new EmailNotification(id, props);
  }

  get eventId(): string {
    return this.props.eventId;
  }

  get template(): EmailTemplate {
    return this.props.template;
  }

  get recipient(): Email {
    return this.props.recipient;
  }

  get reference(): string {
    return this.props.reference;
  }

  get data(): Readonly<Record<string, JsonValue>> {
    return this.props.data;
  }

  get status(): EmailStatus {
    return this.props.status;
  }

  get attempts(): number {
    return this.props.attempts;
  }

  get lastError(): string | null {
    return this.props.lastError;
  }

  get sentAt(): Date | null {
    return this.props.sentAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  // Whether the job still has to send it.
  get pending(): boolean {
    return this.props.status === 'pending';
  }

  // The SMTP server took it. Idempotent; a notification given up stays failed.
  markSent(now: Date): void {
    if (this.props.status !== 'pending') {
      return;
    }
    this.props = {
      ...this.props,
      status: 'sent',
      sentAt: now,
      attempts: this.props.attempts + 1,
      lastError: null,
    };
  }

  // An attempt failed; the job retries it.
  recordFailedAttempt(error: string): void {
    if (this.props.status !== 'pending') {
      return;
    }
    this.props = {
      ...this.props,
      attempts: this.props.attempts + 1,
      lastError: error.slice(0, MAX_ERROR_LENGTH),
    };
  }

  // Still pending long after it was written: its job is gone. Given up, not sent late.
  isStale(now: Date): boolean {
    return this.pending && this.props.createdAt <= staleBefore(now);
  }

  abandon(now: Date): void {
    if (!this.isStale(now)) {
      return;
    }
    this.props = { ...this.props, lastError: this.props.lastError ?? 'abandoned' };
    this.giveUp(now);
  }

  // The job ran out of attempts. Idempotent.
  giveUp(now: Date): void {
    if (this.props.status !== 'pending') {
      return;
    }
    this.props = { ...this.props, status: 'failed' };
    this.record({
      eventType: NotificationsEvents.EmailFailed,
      aggregateType: 'EmailNotification',
      aggregateId: this.id,
      occurredAt: now,
      payload: {
        notificationId: this.id,
        template: this.props.template,
        reference: this.props.reference,
        reason: this.props.lastError ?? 'unknown',
      },
    });
  }
}
