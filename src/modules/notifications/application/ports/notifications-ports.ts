import { type CursorPage, type PageRequest } from '@shared/application';
import { type JsonValue } from '@shared/domain';

import { type DeliveryStatus, type EmailTemplate } from '../../domain';
import { type WebhookDeliveryDto } from '../dto/notifications.dto';

export const EMAIL_SENDER = Symbol('EMAIL_SENDER');
export const EMAIL_RENDERER = Symbol('EMAIL_RENDERER');
export const WEBHOOK_SENDER = Symbol('WEBHOOK_SENDER');
export const WEBHOOK_SECRETS = Symbol('WEBHOOK_SECRETS');
export const RECIPIENTS = Symbol('RECIPIENTS');
export const CENTERS = Symbol('CENTERS');
export const NOTIFICATIONS_QUERIES = Symbol('NOTIFICATIONS_QUERIES');
export const WEBHOOK_TARGETS = Symbol('WEBHOOK_TARGETS');

// A post that got no answer, or that was not made: `code` is a category the center may see
// (`timeout`, `connection_failed`, `dns_failed`, `tls_failed`, `target_not_allowed`), never
// the error text (which would name internal hosts).
export class WebhookPostFailedError extends Error {
  constructor(readonly code: string) {
    super(`Webhook post failed: ${code}`);
    this.name = 'WebhookPostFailedError';
  }
}

// The mail server did not take the message: `code` is a category (`smtp_550`, `timeout`,
// `connection_failed`), never the server's text, which quotes the recipient.
export class EmailSendFailedError extends Error {
  constructor(readonly code: string) {
    super(`Email not sent: ${code}`);
    this.name = 'EmailSendFailedError';
  }
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface OutgoingEmail extends RenderedEmail {
  readonly to: string;
  // The id the email is about, also in a header, for support searches.
  readonly reference: string;
}

// The mail server (SMTP; Mailpit locally). Rejects with EmailSendFailedError when the server
// does not take the message.
export interface EmailSender {
  send(email: OutgoingEmail): Promise<void>;
}

// The templates: one per kind of email, filled with the values recorded with it.
export interface EmailRenderer {
  render(
    template: EmailTemplate,
    data: Readonly<Record<string, JsonValue>>,
    reference: string,
  ): RenderedEmail;
}

export interface WebhookPost {
  readonly url: string;
  readonly secret: string;
  readonly deliveryId: string;
  readonly event: string;
  readonly body: string;
}

// The HTTP client of deliveries: signs the body with the center's secret and posts it. Resolves
// with the status of any answer; rejects with WebhookPostFailedError when there is none
// (timeout, refused connection, a target it will not post to).
export interface WebhookSender {
  post(request: WebhookPost): Promise<{ readonly statusCode: number }>;
}

// Whether Tramo may post to a URL at all where it runs (production: https, and no private
// address written in it); the reason when not.
export interface WebhookTargets {
  refusal(url: string): string | null;
}

export interface WebhookSecrets {
  generate(): string;
}

// Where to write to someone, asked of iam.
export interface Recipients {
  userEmail(userId: string): Promise<string | null>;
  centerContacts(centerId: string): Promise<readonly string[]>;
}

export interface Centers {
  exists(centerId: string): Promise<boolean>;
}

export interface DeliveryFilter {
  readonly status?: DeliveryStatus;
  readonly event?: string;
}

export interface NotificationsQueries {
  listDeliveries(
    centerId: string,
    filter: DeliveryFilter,
    page: PageRequest,
  ): Promise<CursorPage<WebhookDeliveryDto>>;
}
