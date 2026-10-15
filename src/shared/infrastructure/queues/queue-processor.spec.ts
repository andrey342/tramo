import { Logger } from '@nestjs/common';

import { QueueProcessor } from './queue-processor';

class ProbeProcessor extends QueueProcessor {
  protected handle(): Promise<unknown> {
    return Promise.resolve();
  }
}

describe('QueueProcessor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should report its worker's errors through the logger", () => {
    const warnings: unknown[][] = [];
    jest.spyOn(Logger.prototype, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });

    new ProbeProcessor().onError(
      Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
    );

    expect(warnings).toEqual([[{ err: 'read ECONNRESET' }, 'Worker cannot reach Redis']]);
  });
});
