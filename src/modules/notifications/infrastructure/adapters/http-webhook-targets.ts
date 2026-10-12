import { Inject, Injectable } from '@nestjs/common';

import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';

import {
  WebhookPostFailedError,
  type WebhookTargets,
} from '../../application/ports/notifications-ports';

import { assertAllowedTarget } from './http-webhook-sender';

// The same rule as the sender, asked when the webhook is configured: a center learns at once
// that an http URL will never be posted to in production, instead of from failed deliveries.
@Injectable()
export class HttpWebhookTargets implements WebhookTargets {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  refusal(url: string): string | null {
    if (this.config.notifications.webhooks.privateTargetsEnabled) {
      return null;
    }
    try {
      assertAllowedTarget(new URL(url));
      return null;
    } catch (error) {
      if (error instanceof WebhookPostFailedError) {
        return 'only https to public addresses is delivered to';
      }
      throw error;
    }
  }
}
