import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { ConcurrentModificationError } from '@shared/domain';
import { CoreModule } from '@shared/infrastructure/core.module';
import { FieldDecryptionError } from '@shared/infrastructure/crypto';

import { originationRepositoriesContract } from '../../../../../test/contracts/origination-repositories.contract';
import { aDraftApplication, LATER, VALID_DNI } from '../../../../../test/factories/origination';
import { APPLICATION_QUERIES } from '../../application/ports/origination-ports';
import {
  FINANCING_APPLICATION_REPOSITORY,
  type FinancingApplicationRepository,
  RISK_POLICY_REPOSITORY,
} from '../../domain';
import { OriginationModule } from '../../origination.module';

describe('origination repositories (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let applications: FinancingApplicationRepository;
  let db: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), OriginationModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    applications = app.get(FINANCING_APPLICATION_REPOSITORY);
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should keep the national id encrypted and bound to its application', async () => {
    const application = aDraftApplication();
    const other = aDraftApplication();
    await uow.run(async () => {
      await applications.save(application);
      await applications.save(other);
    });

    const [row] = await db.query<{ national_id_encrypted: string }[]>(
      'SELECT national_id_encrypted FROM origination.financing_applications WHERE id = $1',
      [application.id],
    );
    expect(row?.national_id_encrypted.startsWith('v2.')).toBe(true);
    expect(row?.national_id_encrypted).not.toContain(VALID_DNI);

    await db.query(
      `UPDATE origination.financing_applications SET national_id_encrypted = $1 WHERE id = $2`,
      [row?.national_id_encrypted, other.id],
    );
    await expect(applications.findById(other.id)).rejects.toThrow(FieldDecryptionError);
  });

  it('should refuse to save over a newer version', async () => {
    const application = aDraftApplication();
    await uow.run(() => applications.save(application));
    const first = await applications.findById(application.id);
    const second = await applications.findById(application.id);
    if (!first || !second) throw new Error('Application was not saved.');

    first.submit(first.program, LATER);
    second.cancel(LATER);
    await uow.run(() => applications.save(first));

    await expect(uow.run(() => applications.save(second))).rejects.toThrow(
      ConcurrentModificationError,
    );
  });

  it('should seed version 1 of the risk policy', async () => {
    const [row] = await db.query<{ max_financeable_cents: number; approve_threshold: number }[]>(
      'SELECT max_financeable_cents, approve_threshold FROM origination.risk_policies WHERE version = 1',
    );

    expect(row).toEqual({ max_financeable_cents: 1_200_000, approve_threshold: 70 });
  });

  originationRepositoriesContract('TypeORM repositories', () => ({
    applications,
    policies: app.get(RISK_POLICY_REPOSITORY),
    queries: app.get(APPLICATION_QUERIES),
    run: (work) => uow.run(work),
  }));
});
