import { type EmailNotification, type EmailTemplate } from '../model/email-notification';
import { type WebhookDelivery } from '../model/webhook-delivery';
import { type WebhookSubscription } from '../model/webhook-subscription';

export const WEBHOOK_SUBSCRIPTION_REPOSITORY = Symbol('WEBHOOK_SUBSCRIPTION_REPOSITORY');
export const WEBHOOK_DELIVERY_REPOSITORY = Symbol('WEBHOOK_DELIVERY_REPOSITORY');
export const EMAIL_NOTIFICATION_REPOSITORY = Symbol('EMAIL_NOTIFICATION_REPOSITORY');

export interface WebhookSubscriptionRepository {
  findById(id: string): Promise<WebhookSubscription | null>;
  // One per center, active or removed.
  findByCenter(centerId: string): Promise<WebhookSubscription | null>;
  save(subscription: WebhookSubscription): Promise<void>;
}

export interface WebhookDeliveryRepository {
  findById(id: string): Promise<WebhookDelivery | null>;
  // One per center and event: a redelivered event finds the delivery it made.
  findByEvent(centerId: string, eventId: string): Promise<WebhookDelivery | null>;
  save(delivery: WebhookDelivery): Promise<void>;
}

export interface EmailNotificationRepository {
  findById(id: string): Promise<EmailNotification | null>;
  // One per event, template and recipient.
  exists(eventId: string, template: EmailTemplate, recipient: string): Promise<boolean>;
  save(notification: EmailNotification): Promise<void>;
}
