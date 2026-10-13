import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import {
  EmailSendFailedError,
  type EmailSender,
  type OutgoingEmail,
} from '../../application/ports/notifications-ports';

export const REFERENCE_HEADER = 'X-Tramo-Reference';

// Emails through an SMTP server (Mailpit locally). The send resolves once the server accepted the
// message; a refusal or an unreachable server rejects with a category, and the job retries. In
// production, and whenever credentials are sent, the connection must be encrypted: a server that
// does not offer STARTTLS is refused rather than spoken to in clear.
@Injectable()
export class SmtpEmailSender implements EmailSender, OnModuleDestroy {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const { smtp } = config.notifications;
    this.transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTLS: !smtp.secure && (config.env === 'production' || smtp.user !== undefined),
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? '' } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    try {
      await this.transport.sendMail({
        from: this.config.notifications.emailFrom,
        // An address object: never parsed as a list, whatever it contains.
        to: { name: '', address: email.to },
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: { [REFERENCE_HEADER]: email.reference },
      });
    } catch (error) {
      throw new EmailSendFailedError(smtpFailure(error));
    }
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}

// The server's answer code, or what kept it from answering; never its text, which quotes the
// recipient.
function smtpFailure(error: unknown): string {
  const { responseCode, code } = error as { responseCode?: unknown; code?: unknown };
  if (typeof responseCode === 'number') {
    return `smtp_${String(responseCode)}`;
  }
  switch (code) {
    case 'ETIMEDOUT':
      return 'timeout';
    case 'ECONNECTION':
    case 'ESOCKET':
    case 'EDNS':
      return 'connection_failed';
    case 'ETLS':
      return 'tls_failed';
    case 'EAUTH':
      return 'auth_failed';
    case 'EENVELOPE':
      return 'address_refused';
    default:
      return 'send_failed';
  }
}
