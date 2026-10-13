import { DomainError } from '@shared/domain';

export class NotificationsAccessDeniedError extends DomainError {
  readonly code = 'notifications_access_denied';
  readonly category = 'forbidden';

  constructor() {
    super('You cannot manage the notifications of this center.');
  }
}

export class InvalidWebhookUrlError extends DomainError {
  readonly code = 'invalid_webhook_url';
  readonly category = 'validation';

  constructor(reason: string) {
    super(`The webhook URL is not valid: ${reason}.`, { reason });
  }
}

export class WebhookNotConfiguredError extends DomainError {
  readonly code = 'webhook_not_configured';
  readonly category = 'not_found';

  constructor(centerId: string) {
    super('The center has no webhook configured.', { centerId });
  }
}

export class WebhookDeliveryNotFoundError extends DomainError {
  readonly code = 'webhook_delivery_not_found';
  readonly category = 'not_found';

  constructor(deliveryId: string) {
    super('No webhook delivery of this center has this id.', { deliveryId });
  }
}

// The delivery is being posted: wait for its round to end before asking again.
export class WebhookDeliveryInProgressError extends DomainError {
  readonly code = 'webhook_delivery_in_progress';
  readonly category = 'conflict';

  constructor(deliveryId: string) {
    super('The delivery is still being attempted.', { deliveryId });
  }
}
