import { FakeVatValidator } from '../src/modules/catalog/infrastructure/adapters/fake-vat-validator';
import { VatNumber, unwrap } from '../src/shared/domain';

import { awaitingVat, retryWhile, SEED_TAX_IDS } from './seed-vat';

describe('retryWhile', () => {
  const noSleep = (): Promise<void> => Promise.resolve();

  it('should run again after each delay when the result is still undecided', async () => {
    const answers = ['unavailable', 'unavailable', 'valid'];
    const run = jest.fn(() => Promise.resolve(answers.shift() ?? 'none'));
    const slept: number[] = [];

    const result = await retryWhile(run, (answer) => answer === 'unavailable', {
      delaysMs: [100, 200, 400],
      sleep: (ms) => {
        slept.push(ms);
        return Promise.resolve();
      },
    });

    expect(result).toBe('valid');
    expect(run).toHaveBeenCalledTimes(3);
    expect(slept).toEqual([100, 200]);
  });

  it('should return the last result when every attempt stays undecided', async () => {
    const run = jest.fn(() => Promise.resolve('unavailable'));
    const retries: [number, number][] = [];

    const result = await retryWhile(run, () => true, {
      delaysMs: [100, 200],
      sleep: noSleep,
      onRetry: (_result, attempt, delayMs) => retries.push([attempt, delayMs]),
    });

    expect(result).toBe('unavailable');
    expect(run).toHaveBeenCalledTimes(3);
    expect(retries).toEqual([
      [1, 100],
      [2, 200],
    ]);
  });

  it('should not run again when the first result is decided', async () => {
    const run = jest.fn(() => Promise.resolve('invalid'));

    const result = await retryWhile(run, (answer) => answer === 'unavailable', {
      delaysMs: [100],
      sleep: noSleep,
    });

    expect(result).toBe('invalid');
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('SEED_TAX_IDS', () => {
  const fake = new FakeVatValidator();
  const outcome = async (country: string, taxId: string): Promise<string> =>
    (await fake.check(unwrap(VatNumber.create(country, taxId, { registryTestNumbers: true }))))
      .outcome;

  it('should give realistic numbers the offline fake accepts when VIES_MODE is fake', async () => {
    await expect(outcome('ES', SEED_TAX_IDS.codeworks('fake'))).resolves.toBe('valid');
    await expect(outcome('DE', SEED_TAX_IDS.berlin('fake'))).resolves.toBe('valid');
    expect(SEED_TAX_IDS.codeworks('fake')).not.toBe('100');
  });

  it('should keep the third center invalid when VIES_MODE is fake', async () => {
    await expect(outcome('ES', SEED_TAX_IDS.nova('fake'))).resolves.toBe('invalid');
  });

  it('should use the numbers the VIES test service knows when VIES_MODE is test', () => {
    expect([
      SEED_TAX_IDS.codeworks('test'),
      SEED_TAX_IDS.berlin('test'),
      SEED_TAX_IDS.nova('test'),
    ]).toEqual(['100', '100', '200']);
  });
});

describe('awaitingVat', () => {
  it('should wait for a verdict when the registry left the center unverified', () => {
    expect(
      awaitingVat({ status: 'pending_verification', vatValidation: { status: 'unverified' } }),
    ).toBe(true);
  });

  it('should not wait when the number is invalid or the center is active', () => {
    expect(
      awaitingVat({ status: 'pending_verification', vatValidation: { status: 'invalid' } }),
    ).toBe(false);
    expect(awaitingVat({ status: 'active', vatValidation: { status: 'valid' } })).toBe(false);
  });
});
