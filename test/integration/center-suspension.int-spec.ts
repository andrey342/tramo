import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { uuidv7 } from 'uuidv7';

import { CatalogModule } from '@modules/catalog/catalog.module';
import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '@modules/catalog/domain';
import {
  API_KEY_REPOSITORY,
  ApiKey,
  type ApiKeyRepository,
  USER_REPOSITORY,
  type UserRepository,
} from '@modules/iam/domain';
import { IamModule } from '@modules/iam/iam.module';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';
import { MessagingWorkerModule, OutboxPublisher } from '@shared/infrastructure/messaging';

import { anActiveTrainingCenter } from '../factories/catalog';
import { aCenterAdmin } from '../factories/iam';
import { ACROSS_WORKERS, eventually } from '../helpers/eventually';

// Catalog suspends a center; iam hears it through the outbox and revokes the center's API keys.
// The outbox is published by hand; the events.iam consumer runs in this process.
describe('center suspension (integration)', () => {
  let app: INestApplicationContext;
  let publisher: OutboxPublisher;

  beforeAll(async () => {
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreModule.forRoot({ applicationName: 'tramo-int-tests' }),
        MessagingWorkerModule,
        IamModule,
        CatalogModule,
      ],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
    publisher = app.get(OutboxPublisher);
    await app
      .get(DataSource)
      .query('UPDATE shared.outbox_messages SET published_at = now() WHERE published_at IS NULL');
  });

  afterAll(async () => {
    await app.close();
  });

  it("should revoke the center's API keys when catalog suspends it", async () => {
    const uow = app.get<UnitOfWork>(UNIT_OF_WORK);
    const centers = app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY);
    const apiKeys = app.get<ApiKeyRepository>(API_KEY_REPOSITORY);
    const center = anActiveTrainingCenter();
    // The key names who issued it (a foreign key to iam.users).
    const admin = aCenterAdmin({ centerId: center.id });
    const key = ApiKey.issue({
      id: uuidv7(),
      centerId: center.id,
      name: 'ATS',
      prefix: uuidv7().replace(/-/g, '').slice(-8),
      secretHash: `secret-${uuidv7()}`,
      scopes: ['applications:write'],
      issuedBy: admin.id,
      now: new Date(),
    });
    await uow.run(async () => {
      await centers.save(center);
      await app.get<UserRepository>(USER_REPOSITORY).save(admin);
      await apiKeys.save(key);
    });

    const loaded = await centers.findById(center.id);
    loaded?.suspend('Unpaid fees', new Date());
    await uow.run(() => centers.save(loaded!));

    await eventually(async () => {
      await publisher.publishBatch();
      expect((await apiKeys.findById(key.id))?.isActive).toBe(false);
    }, ACROSS_WORKERS);
  });
});
