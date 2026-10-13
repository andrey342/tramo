import { requestsLetThrough } from '../../../../../test/helpers/throttling';

import { ESignatureWebhookController } from './esignature-webhook.controller';

describe('ESignatureWebhookController', () => {
  it('should not rate limit signature callbacks when the provider sends a burst of them', async () => {
    expect(await requestsLetThrough(ESignatureWebhookController, 'callback', 5)).toBe(5);
  });
});
