import { HttpStatus } from '@nestjs/common';
import { type CommandBus, type QueryBus } from '@nestjs/cqrs';

import { type Principal } from '@shared/application';
import { ProblemException } from '@shared/infrastructure/http';
import { QueueUnreachableError } from '@shared/infrastructure/queues';

import { ReportingController } from './reporting.controller';

const OPS: Principal = { kind: 'user', userId: 'ops-1', roles: ['ops'], centerId: null };

describe('ReportingController', () => {
  const controllerFailingWith = (error: Error) =>
    new ReportingController(
      { execute: () => Promise.reject(error) } as unknown as CommandBus,
      {} as QueryBus,
    );

  it('should answer 503 queue_unavailable when the rebuild cannot reach the queue', async () => {
    const rebuild = controllerFailingWith(new QueueUnreachableError(2_000)).rebuild(OPS);

    const problem: unknown = await rebuild.catch((error: unknown) => error);

    expect(problem).toBeInstanceOf(ProblemException);
    expect(problem).toMatchObject({ code: 'queue_unavailable' });
    expect((problem as ProblemException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });

  it('should let other errors through when the rebuild fails for another reason', async () => {
    const failure = new Error('database down');

    await expect(controllerFailingWith(failure).rebuild(OPS)).rejects.toBe(failure);
  });
});
