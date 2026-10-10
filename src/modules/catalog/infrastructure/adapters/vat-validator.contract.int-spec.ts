import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

import { unwrap, VatNumber } from '@shared/domain';
import { type AppConfig } from '@shared/infrastructure/config';

import { vatValidatorContract } from '../../../../../test/contracts/vat-validator.contract';

import { ViesVatValidator } from './vies-vat-validator';

const config = (baseUrl: string, timeoutMs = 5_000): AppConfig =>
  ({ vies: { mode: 'test', baseUrl, timeoutMs } }) as AppConfig;

// Calls the European Commission's test service over the internet, so it only runs when asked
// (CI sets TEST_EXTERNAL_SERVICES=true).
const describeExternal = process.env.TEST_EXTERNAL_SERVICES === 'true' ? describe : describe.skip;
describeExternal('VIES test service', () => {
  vatValidatorContract(
    'ViesVatValidator',
    () => new ViesVatValidator(config('https://ec.europa.eu/taxation_customs/vies/rest-api')),
  );
});

describe('ViesVatValidator resilience (integration)', () => {
  let server: Server;
  let baseUrl: string;
  let respond: (req: IncomingMessage, res: ServerResponse) => void;
  let calls = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      calls += 1;
      respond(req, res);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    calls = 0;
  });

  const vat = unwrap(VatNumber.create('ES', 'B12345678'));
  const json = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
  };

  it('should call the test service endpoint with the country and number', async () => {
    let received: { url?: string; body?: string } = {};
    respond = (req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => {
        received = { url: req.url, body };
        json(res, 200, { valid: true, name: 'CODEWORKS SL' });
      });
    };

    const result = await new ViesVatValidator(config(baseUrl)).check(vat);

    expect(received.url).toBe('/check-vat-test-service');
    expect(JSON.parse(received.body ?? '{}')).toEqual({
      countryCode: 'ES',
      vatNumber: 'B12345678',
    });
    expect(result).toEqual({ outcome: 'valid', provider: 'vies', registeredName: 'CODEWORKS SL' });
  });

  it('should retry a transient failure and use the answer that follows', async () => {
    respond = (_req, res) => {
      if (calls === 1) {
        json(res, 200, { actionSucceed: false, errorWrappers: [{ error: 'MS_UNAVAILABLE' }] });
      } else {
        json(res, 200, { valid: false, name: '---' });
      }
    };

    const result = await new ViesVatValidator(config(baseUrl)).check(vat);

    expect(result).toEqual({ outcome: 'invalid', provider: 'vies' });
    expect(calls).toBe(2);
  });

  it('should treat a malformed number as invalid without retrying', async () => {
    respond = (_req, res) => {
      json(res, 200, { actionSucceed: false, errorWrappers: [{ error: 'INVALID_INPUT' }] });
    };

    expect(await new ViesVatValidator(config(baseUrl)).check(vat)).toMatchObject({
      outcome: 'invalid',
    });
    expect(calls).toBe(1);
  });

  it('should give up on a slow registry after the timeout and answer unavailable', async () => {
    respond = () => undefined; // never answers

    const started = Date.now();
    const result = await new ViesVatValidator(config(baseUrl, 500)).check(vat);

    expect(result).toEqual({ outcome: 'unavailable', provider: 'vies', reason: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('should stop calling a failing registry once the circuit opens', async () => {
    respond = (_req, res) => {
      json(res, 503, {});
    };
    const validator = new ViesVatValidator(config(baseUrl));

    // Three attempts per check: the fifth consecutive failure (second check) opens the circuit.
    await validator.check(vat);
    await validator.check(vat);
    const callsBefore = calls;
    const result = await validator.check(vat);

    expect(result).toEqual({ outcome: 'unavailable', provider: 'vies', reason: 'CIRCUIT_OPEN' });
    expect(calls).toBe(callsBefore);
  });
});
