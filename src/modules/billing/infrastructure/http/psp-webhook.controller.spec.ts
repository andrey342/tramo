import { requestsLetThrough } from '../../../../../test/helpers/throttling';

import { PspWebhookController } from './psp-webhook.controller';

describe('PspWebhookController', () => {
  it('should not rate limit payment callbacks when the provider sends a burst of them', async () => {
    expect(await requestsLetThrough(PspWebhookController, 'callback', 5)).toBe(5);
  });
});
