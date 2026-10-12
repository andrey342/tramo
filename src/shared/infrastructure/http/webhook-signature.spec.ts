import { createHmac } from 'node:crypto';

import { signWebhook, verifyWebhook } from './webhook-signature';

const SECRET = 'webhook-secret-of-at-least-32-characters';
const NOW = new Date('2026-10-12T10:00:00Z');
const BODY = Buffer.from('{"type":"envelope.completed","envelopeId":"env-1"}');

describe('webhook signatures', () => {
  it('should verify what it signs', () => {
    const header = signWebhook(SECRET, BODY, NOW);

    expect(header).toMatch(/^t=1791799200,v1=[0-9a-f]{64}$/);
    expect(verifyWebhook(SECRET, header, BODY, NOW)).toEqual({ valid: true });
  });

  // An independent computation of the scheme: HMAC-SHA256 over "<t>.<body>".
  it('should sign "<timestamp>.<raw body>" with HMAC-SHA256', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`1791799200.${BODY.toString()}`)
      .digest('hex');

    expect(signWebhook(SECRET, BODY, NOW)).toBe(`t=1791799200,v1=${expected}`);
  });

  it('should refuse another body, another secret, or a missing header', () => {
    const header = signWebhook(SECRET, BODY, NOW);

    expect(verifyWebhook(SECRET, header, Buffer.from(`${BODY.toString()} `), NOW)).toEqual({
      valid: false,
      reason: 'mismatch',
    });
    expect(verifyWebhook('another-secret-of-at-least-32-chars', header, BODY, NOW).valid).toBe(
      false,
    );
    expect(verifyWebhook(SECRET, undefined, BODY, NOW)).toEqual({
      valid: false,
      reason: 'malformed',
    });
  });

  it('should refuse a signature older or newer than five minutes', () => {
    const header = signWebhook(SECRET, BODY, NOW);

    expect(verifyWebhook(SECRET, header, BODY, new Date(NOW.getTime() + 300_000)).valid).toBe(true);
    expect(verifyWebhook(SECRET, header, BODY, new Date(NOW.getTime() + 301_000))).toEqual({
      valid: false,
      reason: 'expired',
    });
    expect(verifyWebhook(SECRET, header, BODY, new Date(NOW.getTime() - 301_000)).valid).toBe(
      false,
    );
  });

  it('should accept any of several signatures, as during a secret rotation', () => {
    const [timestamp, current] = signWebhook(SECRET, BODY, NOW).split(',');
    const old = `v1=${'0'.repeat(64)}`;

    expect(verifyWebhook(SECRET, `${timestamp ?? ''},${old},${current ?? ''}`, BODY, NOW)).toEqual({
      valid: true,
    });
  });

  it.each(['t=abc,v1=00', 'v1=' + '0'.repeat(64), 't=1791799200', 't=1,t=2,v1=' + '0'.repeat(64)])(
    'should refuse the malformed header %s',
    (header) => {
      expect(verifyWebhook(SECRET, header, BODY, NOW)).toEqual({
        valid: false,
        reason: 'malformed',
      });
    },
  );
});
