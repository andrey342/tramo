import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AbandonStaleEmailsHandler } from './application/commands/abandon-stale-emails.command';
import { ConfigureWebhookHandler } from './application/commands/configure-webhook.command';
import { DeliverWebhookHandler } from './application/commands/deliver-webhook.command';
import { PublishWebhookHandler } from './application/commands/publish-webhook.command';
import { RedeliverWebhookHandler } from './application/commands/redeliver-webhook.command';
import { RemoveWebhookHandler } from './application/commands/remove-webhook.command';
import { RequestEmailHandler } from './application/commands/request-email.command';
import { SendEmailHandler } from './application/commands/send-email.command';
import {
  CENTERS,
  EMAIL_RENDERER,
  EMAIL_SENDER,
  NOTIFICATIONS_QUERIES,
  RECIPIENTS,
  WEBHOOK_SECRETS,
  WEBHOOK_SENDER,
  WEBHOOK_TARGETS,
} from './application/ports/notifications-ports';
import { GetWebhookHandler } from './application/queries/get-webhook.query';
import { ListWebhookDeliveriesHandler } from './application/queries/list-webhook-deliveries.query';
import {
  EMAIL_NOTIFICATION_REPOSITORY,
  WEBHOOK_DELIVERY_REPOSITORY,
  WEBHOOK_SUBSCRIPTION_REPOSITORY,
} from './domain';
import { HandlebarsEmailRenderer } from './infrastructure/adapters/handlebars-email-renderer';
import { HttpWebhookSender } from './infrastructure/adapters/http-webhook-sender';
import { HttpWebhookTargets } from './infrastructure/adapters/http-webhook-targets';
import {
  CatalogCenters,
  IamRecipients,
  RandomWebhookSecrets,
} from './infrastructure/adapters/notifications-lookups';
import { SmtpEmailSender } from './infrastructure/adapters/smtp-email-sender';
import { NOTIFICATION_CONSUMERS } from './infrastructure/consumers/notifications.consumers';
import { EmailJobs, WebhookJobs } from './infrastructure/jobs/notifications-jobs';
import { WebhookSubscriptionMapper } from './infrastructure/persistence/notifications.mappers';
import {
  EmailNotificationOrmEntity,
  WebhookDeliveryOrmEntity,
  WebhookSubscriptionOrmEntity,
} from './infrastructure/persistence/notifications.orm-entities';
import { TypeOrmNotificationsQueries } from './infrastructure/persistence/typeorm-notifications.queries';
import {
  TypeOrmEmailNotificationRepository,
  TypeOrmWebhookDeliveryRepository,
  TypeOrmWebhookSubscriptionRepository,
} from './infrastructure/persistence/typeorm-notifications.repositories';

// Use cases, persistence and adapters of the notifications context. Shared by both processes; the HTTP
// surface lives in NotificationsHttpModule, which only the api imports, and queue processors in
// NotificationsWorkerModule, which only the worker imports.
@Module({
  imports: [
    TypeOrmModule.forFeature([
      WebhookSubscriptionOrmEntity,
      WebhookDeliveryOrmEntity,
      EmailNotificationOrmEntity,
    ]),
  ],
  providers: [
    WebhookSubscriptionMapper,
    { provide: WEBHOOK_SUBSCRIPTION_REPOSITORY, useClass: TypeOrmWebhookSubscriptionRepository },
    { provide: WEBHOOK_DELIVERY_REPOSITORY, useClass: TypeOrmWebhookDeliveryRepository },
    { provide: EMAIL_NOTIFICATION_REPOSITORY, useClass: TypeOrmEmailNotificationRepository },
    { provide: NOTIFICATIONS_QUERIES, useClass: TypeOrmNotificationsQueries },
    { provide: EMAIL_SENDER, useClass: SmtpEmailSender },
    { provide: EMAIL_RENDERER, useClass: HandlebarsEmailRenderer },
    { provide: WEBHOOK_SENDER, useClass: HttpWebhookSender },
    { provide: WEBHOOK_TARGETS, useClass: HttpWebhookTargets },
    { provide: WEBHOOK_SECRETS, useClass: RandomWebhookSecrets },
    { provide: RECIPIENTS, useClass: IamRecipients },
    { provide: CENTERS, useClass: CatalogCenters },
    ConfigureWebhookHandler,
    RemoveWebhookHandler,
    PublishWebhookHandler,
    DeliverWebhookHandler,
    RedeliverWebhookHandler,
    RequestEmailHandler,
    SendEmailHandler,
    AbandonStaleEmailsHandler,
    GetWebhookHandler,
    ListWebhookDeliveriesHandler,
    EmailJobs,
    WebhookJobs,
    ...NOTIFICATION_CONSUMERS,
  ],
  exports: [],
})
export class NotificationsModule {}
