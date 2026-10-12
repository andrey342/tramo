import { type INestApplicationContext } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Test } from '@nestjs/testing';
import { uuidv7 } from 'uuidv7';

import { FindCenterQuery } from '@modules/catalog/application/dto/center-lookup';
import { FindProgramQuery } from '@modules/catalog/application/dto/program-lookup';
import {
  FindUserContactQuery,
  ListCenterContactsQuery,
} from '@modules/iam/application/dto/contact-lookup';
import { FindContractQuery } from '@modules/lending/application/dto/contract-lookup';
import {
  AssessIsaPeriodCommand,
  ListBillablePlansQuery,
} from '@modules/lending/application/dto/plan-lookup';
import { EntityNotFoundError } from '@shared/domain';

import { WorkerModule } from './worker.module';

// Consumers ask other modules through their public queries and commands; in the worker those
// handlers exist only if their module is loaded there. Builds the real worker and asks each one.
describe('WorkerModule (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should answer the public queries the consumers rely on', async () => {
    const queries = app.get(QueryBus);
    const unknown = uuidv7();

    expect(await queries.execute(new FindUserContactQuery(unknown))).toBeNull();
    expect(await queries.execute(new ListCenterContactsQuery(unknown))).toEqual([]);
    expect(await queries.execute(new FindCenterQuery(unknown))).toBeNull();
    expect(await queries.execute(new FindProgramQuery(unknown))).toBeNull();
    expect(await queries.execute(new FindContractQuery(unknown))).toBeNull();
    expect(await queries.execute(new ListBillablePlansQuery(null, 1, unknown))).toEqual([]);
  });

  it('should run the public command billing relies on', async () => {
    await expect(
      app.get(CommandBus).execute(new AssessIsaPeriodCommand(uuidv7(), '2026-07', null)),
    ).rejects.toThrow(EntityNotFoundError);
  });
});
