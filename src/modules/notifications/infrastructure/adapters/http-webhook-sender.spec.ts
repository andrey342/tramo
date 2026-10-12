import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { FixedClock } from '@shared/domain';
import { parseConfig } from '@shared/infrastructure/config/app-config';
import { verifyWebhook } from '@shared/infrastructure/http';

import {
  HttpWebhookSender,
  isPrivateAddress,
  WebhookTargetRefusedError,
} from './http-webhook-sender';

const NOW = new Date('2026-11-12T08:00:00Z');
const SECRET = 'whsec_test_secret_of_enough_length_0123456789';
const ENV = {
  DATABASE_URL: 'postgres://tramo:tramo@localhost:5432/tramo',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  ESIGN_WEBHOOK_SECRET: 'e'.repeat(32),
  PSP_WEBHOOK_SECRET: 'p'.repeat(32),
  WEBHOOK_TIMEOUT_MS: '2000',
};

const sender = (privateTargets: boolean) =>
  new HttpWebhookSender(
    parseConfig({ ...ENV, WEBHOOK_PRIVATE_TARGETS_ENABLED: String(privateTargets) }),
    new FixedClock(NOW),
  );

interface Received {
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

describe('HttpWebhookSender', () => {
  let server: Server;
  let url: string;
  const received: Received[] = [];
  let answer = 200;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        if (answer === 302) {
          response.writeHead(302, { location: 'http://169.254.169.254/latest' }).end();
          return;
        }
        response.writeHead(answer).end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/hooks`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
    answer = 200;
  });

  it('should post the body signed with the secret, with the delivery and the event', async () => {
    const body = JSON.stringify({ id: 'event-1', event: 'contract.signed', data: {} });

    const result = await sender(true).post({
      url,
      secret: SECRET,
      deliveryId: 'delivery-1',
      event: 'contract.signed',
      body,
    });

    expect(result).toEqual({ statusCode: 200 });
    const [request] = received;
    expect(request?.body).toBe(body);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['x-tramo-delivery-id']).toBe('delivery-1');
    expect(request?.headers['x-tramo-event']).toBe('contract.signed');
    const signature = request?.headers['x-tramo-signature'];
    expect(
      verifyWebhook(
        SECRET,
        typeof signature === 'string' ? signature : undefined,
        Buffer.from(body),
        NOW,
      ),
    ).toEqual({ valid: true });
  });

  it('should report the status of any answer, and not follow a redirect', async () => {
    const post = (status: number) => {
      answer = status;
      return sender(true).post({ url, secret: SECRET, deliveryId: 'd', event: 'e', body: '{}' });
    };

    expect(await post(503)).toEqual({ statusCode: 503 });
    expect(await post(302)).toEqual({ statusCode: 302 });
    expect(received).toHaveLength(2);
  });

  it('should refuse plain http and private addresses where private targets are off', async () => {
    const post = (target: string) =>
      sender(false).post({ url: target, secret: SECRET, deliveryId: 'd', event: 'e', body: '{}' });

    await expect(post(url)).rejects.toThrow(WebhookTargetRefusedError);
    await expect(post('https://127.0.0.1/hooks')).rejects.toThrow('not a public address');
    await expect(post('https://[::1]/hooks')).rejects.toThrow('not a public address');
    await expect(post('https://localhost/hooks')).rejects.toThrow('not a public address');
    expect(received).toEqual([]);
  });

  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.5', true],
    ['192.168.1.10', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.1', true],
    ['not-an-ip', true],
    ['8.8.8.8', false],
    ['2001:4860:4860::8888', false],
    ['::ffff:8.8.8.8', false],
  ])('should take %s as private: %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });
});
