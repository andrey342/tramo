import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { catalogRepositoriesContract } from '../../../../../test/contracts/catalog-repositories.contract';
import { aTrainingCenter, VALID_IBAN } from '../../../../../test/factories/catalog';
import { CatalogModule } from '../../catalog.module';
import {
  CatalogEvents,
  PROGRAM_REPOSITORY,
  TRAINING_CENTER_REPOSITORY,
  type TrainingCenterRepository,
} from '../../domain';

describe('catalog repositories (integration)', () => {
  let app: INestApplicationContext;
  let uow: UnitOfWork;
  let centers: TrainingCenterRepository;
  let db: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), CatalogModule],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    uow = app.get(UNIT_OF_WORK);
    centers = app.get(TRAINING_CENTER_REPOSITORY);
    db = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('should keep the payout IBAN encrypted at rest, with only its last four in clear', async () => {
    const center = aTrainingCenter();
    await uow.run(() => centers.save(center));

    const [row] = await db.query<{ payout_iban_encrypted: string; payout_iban_last4: string }[]>(
      'SELECT payout_iban_encrypted, payout_iban_last4 FROM catalog.training_centers WHERE id = $1',
      [center.id],
    );

    expect(row?.payout_iban_encrypted.startsWith('v1.')).toBe(true);
    expect(row?.payout_iban_encrypted).not.toContain(VALID_IBAN.slice(4));
    expect(row?.payout_iban_last4).toBe('1332');
  });

  it('should write the registration event to the outbox with the center', async () => {
    const center = aTrainingCenter();
    await uow.run(() => centers.save(center));

    const outbox: { event_type: string }[] = await db.query(
      'SELECT event_type FROM shared.outbox_messages WHERE aggregate_id = $1',
      [center.id],
    );
    expect(outbox.map((row) => row.event_type)).toEqual([CatalogEvents.CenterRegistered]);
  });

  catalogRepositoriesContract('TypeORM repositories', () => ({
    centers,
    programs: app.get(PROGRAM_REPOSITORY),
    run: (work) => uow.run(work),
  }));
});
