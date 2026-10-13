import { QueueUnreachableError, withinQueueTimeout } from './queue-timeout';

describe('withinQueueTimeout', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('should answer with the call when it settles in time', async () => {
    await expect(withinQueueTimeout(Promise.resolve(7), 100)).resolves.toBe(7);
    await expect(withinQueueTimeout(Promise.reject(new Error('NOSCRIPT')), 100)).rejects.toThrow(
      'NOSCRIPT',
    );
  });

  it('should reject with QueueUnreachableError when the call takes longer than the timeout', async () => {
    jest.useFakeTimers();

    const settled = expect(withinQueueTimeout(new Promise(() => undefined), 100)).rejects.toThrow(
      QueueUnreachableError,
    );
    await jest.advanceTimersByTimeAsync(100);

    await settled;
  });
});
