import { createHmac, timingSafeEqual } from 'node:crypto';

// Signed webhooks, both ways (providers calling Tramo, Tramo calling training centers):
//   X-...-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
// The timestamp is signed with the body, so a captured request cannot be replayed once it is older
// than the tolerance. Several v1 values may be sent while a secret is being rotated.
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export function signWebhook(secret: string, rawBody: string | Buffer, now: Date): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  return `t=${String(timestamp)},v1=${hmac(secret, timestamp, rawBody)}`;
}

export type WebhookVerification =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'malformed' | 'expired' | 'mismatch' };

export function verifyWebhook(
  secret: string,
  header: string | undefined,
  rawBody: Buffer,
  now: Date,
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): WebhookVerification {
  const parts = (header ?? '').split(',').map((part) => part.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 't').map(([, value]) => Number(value));
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value ?? '');
  const [timestamp] = timestamps;
  if (timestamps.length !== 1 || timestamp === undefined || !Number.isInteger(timestamp)) {
    return { valid: false, reason: 'malformed' };
  }
  if (signatures.length === 0 || !signatures.every((value) => /^[0-9a-f]{64}$/.test(value))) {
    return { valid: false, reason: 'malformed' };
  }
  if (Math.abs(now.getTime() / 1000 - timestamp) > toleranceSeconds) {
    return { valid: false, reason: 'expired' };
  }
  const expected = Buffer.from(hmac(secret, timestamp, rawBody), 'hex');
  const matches = signatures.some((value) => timingSafeEqual(Buffer.from(value, 'hex'), expected));
  return matches ? { valid: true } : { valid: false, reason: 'mismatch' };
}

function hmac(secret: string, timestamp: number, rawBody: string | Buffer): string {
  return createHmac('sha256', secret)
    .update(`${String(timestamp)}.`)
    .update(rawBody)
    .digest('hex');
}
