import { type INestApplicationContext } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { CatalogModule } from '@modules/catalog/catalog.module';
import { TRAINING_CENTER_REPOSITORY, type TrainingCenterRepository } from '@modules/catalog/domain';
import { UNIT_OF_WORK, type UnitOfWork } from '@shared/application';
import { CoreModule } from '@shared/infrastructure/core.module';

import { CatalogCenterDirectory } from '../../src/modules/iam/infrastructure/adapters/catalog-center-directory';
import { centerDirectoryContract } from '../contracts/center-directory.contract';
import { aTrainingCenter } from '../factories/catalog';

// Crosses two modules (iam's adapter, catalog's query), so it lives outside both.
describe('CatalogCenterDirectory (integration)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CoreModule.forRoot({ applicationName: 'tramo-int-tests' }), CatalogModule],
      providers: [CatalogCenterDirectory],
    }).compile();
    moduleRef.useLogger(false);
    app = await moduleRef.init();
  });

  afterAll(async () => {
    await app.close();
  });

  centerDirectoryContract('CatalogCenterDirectory over the query bus', async () => {
    const center = aTrainingCenter();
    const centers = app.get<TrainingCenterRepository>(TRAINING_CENTER_REPOSITORY);
    await app.get<UnitOfWork>(UNIT_OF_WORK).run(() => centers.save(center));
    return { directory: app.get(CatalogCenterDirectory), existingCenterId: center.id };
  });
});
