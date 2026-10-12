import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { signWebhook } from '@shared/infrastructure/http';

import { type WebhookPost, type WebhookSender } from '../../application/ports/notifications-ports';

export const SIGNATURE_HEADER = 'X-Tramo-Signature';
export const DELIVERY_HEADER = 'X-Tramo-Delivery-Id';
export const EVENT_HEADER = 'X-Tramo-Event';

// Addresses a delivery never goes to where private targets are off: loopback, private networks,
// link-local (cloud metadata), carrier NAT, multicast and reserved ranges.
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1]) {
    return PRIVATE.check(mapped[1], 'ipv4');
  }
  const family = isIP(address);
  return family === 0 || PRIVATE.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class WebhookTargetRefusedError extends Error {
  constructor(reason: string) {
    super(`Webhook target refused: ${reason}`);
    this.name = 'WebhookTargetRefusedError';
  }
}

// Posts deliveries to the centers' endpoints: JSON, signed (t=<unix>,v1=<HMAC-SHA256 of
// "<t>.<body>">, as Tramo's own incoming webhooks), with the delivery id and the event in headers.
// Redirects are not followed (a 3xx is a failed attempt). Where private targets are off
// (production), only https to public addresses is posted: the host is resolved first, so a name
// pointing inside the network is refused (a check, not a pin: a name that changes its answer
// between the check and the request is the residual risk, see the architecture notes).
@Injectable()
export class HttpWebhookSender implements WebhookSender {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async post(request: WebhookPost): Promise<{ readonly statusCode: number }> {
    const { webhooks } = this.config.notifications;
    if (!webhooks.privateTargetsEnabled) {
      await this.assertPublic(new URL(request.url));
    }
    const response = await fetch(request.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Tramo-Webhooks/1',
        [SIGNATURE_HEADER]: signWebhook(request.secret, request.body, this.clock.now()),
        [DELIVERY_HEADER]: request.deliveryId,
        [EVENT_HEADER]: request.event,
      },
      body: request.body,
      redirect: 'manual',
      signal: AbortSignal.timeout(webhooks.timeoutMs),
    });
    // The body is not used; reading it frees the connection.
    await response.arrayBuffer().catch(() => undefined);
    return { statusCode: response.status };
  }

  private async assertPublic(url: URL): Promise<void> {
    if (url.protocol !== 'https:') {
      throw new WebhookTargetRefusedError('only https is delivered to');
    }
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host)
      ? [host]
      : (await lookup(host, { all: true, verbatim: true })).map((entry) => entry.address);
    if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
      throw new WebhookTargetRefusedError(`${url.hostname} is not a public address`);
    }
  }
}
