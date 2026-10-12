import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import { type EmailSender, type OutgoingEmail } from '../../application/ports/notifications-ports';

export const REFERENCE_HEADER = 'X-Tramo-Reference';

// Emails through an SMTP server (Mailpit locally). The send resolves once the server accepted the
// message; a refusal or an unreachable server rejects, and the job retries.
@Injectable()
export class SmtpEmailSender implements EmailSender, OnModuleDestroy {
  private readonly transport: Transporter;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    const { smtp } = config.notifications;
    this.transport = createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password ?? '' } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transport.sendMail({
      from: this.config.notifications.emailFrom,
      to: email.to,
      subject: email.subject,
      text: email.text,
      html: email.html,
      headers: { [REFERENCE_HEADER]: email.reference },
    });
  }

  onModuleDestroy(): void {
    this.transport.close();
  }
}
