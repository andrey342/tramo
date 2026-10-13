// Published contract of the notifications module: other modules subscribe to these by event type and
// read the payload, never the aggregates. Payloads are type aliases (not interfaces) so they
// satisfy the JSON payload constraint of DomainEvent.
export const NotificationsEvents = {
  EmailRequested: 'EmailRequested',
  EmailFailed: 'EmailFailed',
  WebhookSubscribed: 'WebhookSubscribed',
  WebhookUnsubscribed: 'WebhookUnsubscribed',
  WebhookDeliveryRequested: 'WebhookDeliveryRequested',
  WebhookDelivered: 'WebhookDelivered',
  WebhookDeliveryFailed: 'WebhookDeliveryFailed',
} as const;

// An email was written down to be sent; a job sends it. Says nothing of its content or recipient.
export type EmailRequestedPayload = {
  readonly notificationId: string;
  readonly template: string;
  readonly reference: string;
};

export type EmailFailedPayload = {
  readonly notificationId: string;
  readonly template: string;
  readonly reference: string;
  readonly reason: string;
};

export type WebhookSubscribedPayload = {
  readonly subscriptionId: string;
  readonly centerId: string;
};

export type WebhookUnsubscribedPayload = {
  readonly subscriptionId: string;
  readonly centerId: string;
};

// A delivery (or a redelivery: a new round) is due; a job posts it.
export type WebhookDeliveryRequestedPayload = {
  readonly deliveryId: string;
  readonly centerId: string;
  readonly event: string;
  readonly round: number;
};

export type WebhookDeliveredPayload = {
  readonly deliveryId: string;
  readonly centerId: string;
  readonly event: string;
  readonly round: number;
};

// Every attempt of a round failed: the center's endpoint is down or refuses it; the center (or
// ops) can redeliver.
export type WebhookDeliveryFailedPayload = {
  readonly deliveryId: string;
  readonly centerId: string;
  readonly event: string;
  readonly round: number;
  readonly lastError: string;
};
