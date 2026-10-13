import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '@shared/domain';
import { APP_CONFIG, type AppConfig } from '@shared/infrastructure/config';
import { signWebhook } from '@shared/infrastructure/http';

import {
  type WebhookPost,
  WebhookPostFailedError,
  type WebhookSender,
} from '../../application/ports/notifications-ports';

export const SIGNATURE_HEADER = 'X-Tramo-Signature';
export const DELIVERY_HEADER = 'X-Tramo-Delivery-Id';
export const EVENT_HEADER = 'X-Tramo-Event';

// Addresses a delivery never goes to where private targets are off: loopback, private networks,
// link-local (cloud metadata), carrier-grade NAT, documentation, benchmarking, multicast and
// reserved ranges, and the IPv6 forms that carry an IPv4 address (NAT64, 6to4, Teredo,
// IPv4-compatible).
const PRIVATE = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  PRIVATE.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
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

// Resolves like the system does, refuses the name if any of its addresses is private, and hands
// the connection the address it checked: the check and the connection see the same address, so a
// name that changes its answer in between (DNS rebinding) cannot slip through. A name that does
// not resolve fails the same way as one refused, so the answer says nothing of which internal
// names exist.
type Resolve = (
  hostname: string,
  options: { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

export function publicLookupWith(resolve: Resolve): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (
        error ||
        addresses.length === 0 ||
        addresses.some((entry) => isPrivateAddress(entry.address))
      ) {
        callback(new WebhookPostFailedError('target_unreachable'), '', 0);
        return;
      }
      if (options.all) {
        callback(null, addresses);
        return;
      }
      const [first] = addresses;
      callback(null, first?.address ?? '', first?.family ?? 4);
    });
  };
}

const publicLookup = publicLookupWith((hostname, options, callback) => {
  dnsLookup(hostname, options, callback);
});

// What the center is shown about an attempt that got no answer: a category, never the error text
// (which would name internal hosts and addresses).
function failureCode(error: unknown): string {
  if (error instanceof WebhookPostFailedError) {
    return error.code;
  }
  const code = (error as { code?: unknown }).code;
  switch (code) {
    case 'ECONNREFUSED':
    case 'ECONNRESET':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'connection_failed';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'dns_failed';
    case 'ETIMEDOUT':
    case 'ABORT_ERR':
      return 'timeout';
    default:
      return typeof code === 'string' && /CERT|SSL|TLS|VERIFY|SELF_SIGNED/i.test(code)
        ? 'tls_failed'
        : 'network_failed';
  }
}

// Posts deliveries to the centers' endpoints: JSON, signed (t=<unix>,v1=<HMAC-SHA256 of
// "<t>.<body>">, as Tramo's own incoming webhooks), with the delivery id and the event in headers.
// Only the status of the answer is read: its body is never buffered, and redirects are not
// followed (a 3xx is a failed attempt). Where private targets are off (production), only https to
// public addresses is posted, the address checked being the one connected to (ADR 018).
@Injectable()
export class HttpWebhookSender implements WebhookSender {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async post(request: WebhookPost): Promise<{ readonly statusCode: number }> {
    const { webhooks } = this.config.notifications;
    const url = new URL(request.url);
    const restricted = !webhooks.privateTargetsEnabled;
    if (restricted) {
      assertAllowedTarget(url);
    }
    const options: RequestOptions = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(request.body),
        'Accept-Encoding': 'identity',
        'User-Agent': 'Tramo-Webhooks/1',
        [SIGNATURE_HEADER]: signWebhook(request.secret, request.body, this.clock.now()),
        [DELIVERY_HEADER]: request.deliveryId,
        [EVENT_HEADER]: request.event,
      },
      signal: AbortSignal.timeout(webhooks.timeoutMs),
      ...(restricted ? { lookup: publicLookup } : {}),
    };
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    try {
      const statusCode = await new Promise<number>((resolve, reject) => {
        const outgoing = send(url, options, (response: IncomingMessage) => {
          resolve(response.statusCode ?? 0);
          // The status is all that matters: the rest of the answer is dropped, not read.
          response.destroy();
        });
        outgoing.on('error', reject);
        outgoing.end(request.body);
      });
      return { statusCode };
    } catch (error) {
      throw new WebhookPostFailedError(failureCode(error));
    }
  }
}

// Production posts only over https, and never to an address written in the URL that is private.
// Names are checked when they are resolved, at connection time (publicLookup).
export function assertAllowedTarget(url: URL): void {
  if (url.protocol !== 'https:') {
    throw new WebhookPostFailedError('target_unreachable');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isPrivateAddress(host)) {
    throw new WebhookPostFailedError('target_unreachable');
  }
}
