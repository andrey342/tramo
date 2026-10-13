import { createServer, type IncomingMessage, type Server } from 'node:http';
import { type AddressInfo } from 'node:net';

import { FixedClock } from '@shared/domain';
import { parseConfig } from '@shared/infrastructure/config/app-config';
import { verifyWebhook } from '@shared/infrastructure/http';

import { webhookSenderContract } from '../../../../../test/contracts/notifications-ports.contract';
import { FakeWebhookSender } from '../../../../../test/fakes/notifications';
import { WebhookPostFailedError } from '../../application/ports/notifications-ports';

import { HttpWebhookSender, isPrivateAddress, publicLookupWith } from './http-webhook-sender';
import { HttpWebhookTargets } from './http-webhook-targets';

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

const config = (privateTargets: boolean) =>
  parseConfig({ ...ENV, WEBHOOK_PRIVATE_TARGETS_ENABLED: String(privateTargets) });
const sender = (privateTargets: boolean) =>
  new HttpWebhookSender(config(privateTargets), new FixedClock(NOW));

interface Received {
  readonly headers: IncomingMessage['headers'];
  readonly body: string;
}

describe('HttpWebhookSender', () => {
  let server: Server;
  let base: string;
  const received: Received[] = [];

  beforeAll(async () => {
    // Answers the status in the path (/hooks/503), and for /huge streams a large body.
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({ headers: request.headers, body: Buffer.concat(chunks).toString('utf8') });
        if (request.url === '/huge') {
          response.writeHead(200);
          response.end(Buffer.alloc(8 * 1024 * 1024, 1));
          return;
        }
        const status = Number(request.url?.split('/').at(-1)) || 200;
        response
          .writeHead(status, status === 302 ? { location: 'http://169.254.169.254/latest' } : {})
          .end('{}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    received.length = 0;
  });

  it('should post the body signed with the secret, with the delivery and the event', async () => {
    const body = JSON.stringify({ id: 'event-1', event: 'contract.signed', data: {} });

    const result = await sender(true).post({
      url: `${base}/hooks/200`,
      secret: SECRET,
      deliveryId: 'delivery-1',
      event: 'contract.signed',
      body,
    });

    expect(result).toEqual({ statusCode: 200 });
    const [request] = received;
    expect(request?.body).toBe(body);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.headers['accept-encoding']).toBe('identity');
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

  it('should not follow a redirect, nor read the answer it does not need', async () => {
    const post = (path: string) =>
      sender(true).post({
        url: `${base}${path}`,
        secret: SECRET,
        deliveryId: 'd',
        event: 'e',
        body: '{}',
      });

    expect(await post('/hooks/302')).toEqual({ statusCode: 302 });
    expect(await post('/huge')).toEqual({ statusCode: 200 });
    expect(received).toHaveLength(2);
  });

  it('should refuse plain http and private addresses where private targets are off', async () => {
    const post = (target: string) =>
      sender(false)
        .post({ url: target, secret: SECRET, deliveryId: 'd', event: 'e', body: '{}' })
        .catch((error: unknown) => error);

    for (const target of [
      `${base}/hooks/200`,
      'https://127.0.0.1/hooks',
      'https://[::1]/hooks',
      'https://[64:ff9b::a00:5]/hooks',
      'https://localhost/hooks',
    ]) {
      const failure = await post(target);
      expect(failure).toBeInstanceOf(WebhookPostFailedError);
      expect((failure as WebhookPostFailedError).code).toBe('target_unreachable');
    }
    expect(received).toEqual([]);
  });

  it('should tell a center at configuration that only https to public addresses is posted', () => {
    const production = new HttpWebhookTargets(config(false));
    const development = new HttpWebhookTargets(config(true));

    expect(production.refusal('http://center.example/hooks')).toMatch(/https/);
    expect(production.refusal('https://10.0.0.5/hooks')).toMatch(/public/);
    expect(production.refusal('https://center.example/hooks')).toBeNull();
    expect(development.refusal('http://webhook-sink:9099/x')).toBeNull();
  });

  // The connection uses the address the lookup checked; a private or unknown name fails alike.
  it('should hand the connection the public address it checked', async () => {
    const lookupOf = (answer: Error | { address: string; family: number }[]) =>
      publicLookupWith((_host, _options, callback) => {
        if (answer instanceof Error) callback(answer, []);
        else callback(null, answer);
      });
    const one = (lookup: ReturnType<typeof lookupOf>) =>
      new Promise<[Error | null, string]>((resolve) => {
        lookup('center.example', { all: false }, (error, address) => {
          resolve([error, typeof address === 'string' ? address : '']);
        });
      });

    expect(await one(lookupOf([{ address: '93.184.215.14', family: 4 }]))).toEqual([
      null,
      '93.184.215.14',
    ]);
    const [privateError] = await one(lookupOf([{ address: '10.0.0.5', family: 4 }]));
    const [unknownError] = await one(lookupOf(new Error('getaddrinfo ENOTFOUND')));
    expect((privateError as WebhookPostFailedError).code).toBe('target_unreachable');
    expect((unknownError as WebhookPostFailedError).code).toBe('target_unreachable');
  });

  it.each([
    ['127.0.0.1', true],
    ['10.1.2.3', true],
    ['172.20.0.5', true],
    ['192.168.1.10', true],
    ['169.254.169.254', true],
    ['100.64.0.1', true],
    ['203.0.113.7', true],
    ['::1', true],
    ['fd00::1', true],
    ['fe80::1', true],
    ['::ffff:10.0.0.1', true],
    ['64:ff9b::a00:5', true],
    ['2002:a00:5::1', true],
    ['::a00:5', true],
    ['not-an-ip', true],
    ['8.8.8.8', false],
    ['2001:4860:4860::8888', false],
    ['::ffff:8.8.8.8', false],
  ])('should take %s as private: %s', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });

  webhookSenderContract('HttpWebhookSender', () => ({
    sender: sender(true),
    answering: (status) => `${base}/hooks/${String(status)}`,
    unreachable: 'http://127.0.0.1:9/hooks',
  }));
});

webhookSenderContract('FakeWebhookSender', () => {
  const fake = new FakeWebhookSender();
  return {
    sender: {
      post: (request) => {
        const status = Number(request.url.split('/').at(-1));
        fake.answers.push(Number.isNaN(status) ? 'connection_failed' : status);
        return fake.post(request);
      },
    },
    answering: (status) => `https://center.example/hooks/${String(status)}`,
    unreachable: 'https://unreachable.example/hooks/none',
  };
});
